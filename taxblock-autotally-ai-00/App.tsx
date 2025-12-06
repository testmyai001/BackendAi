
import React, { useState, useEffect } from 'react';
import InvoiceEditor from './components/InvoiceEditor';
import XmlViewer from './components/XmlViewer';
import JsonViewer from './components/JsonViewer';
import TallyLogs from './components/TallyLogs';
import Dashboard from './components/Dashboard';
import InvoiceUpload from './components/InvoiceUpload';
import ChatBot from './components/ChatBot';
import ImageAnalyzer from './components/ImageAnalyzer';
import BankStatementManager from './components/BankStatementManager';
import ExcelImportManager from './components/ExcelImportManager';
import Navbar from './components/Navbar';
import InvalidFileModal from './components/InvalidFileModal';
import SettingsModal from './components/SettingsModal';
import { InvoiceData, LogEntry, AppView, ProcessedFile } from './types';
import { CheckCircle2, X, FileText } from 'lucide-react';
import { generateTallyXml, pushToTally, fetchExistingLedgers, checkTallyConnection } from './services/tallyService';
import { parseInvoiceWithGemini } from './services/geminiService';
import { saveLogToDB, saveInvoiceToDB } from './services/dbService';
import { TALLY_API_URL } from './constants';
import { v4 as uuidv4 } from 'uuid';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  
  // Bulk Processing State
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  
  // Currently Active Invoice
  const [currentInvoice, setCurrentInvoice] = useState<InvoiceData | null>(null);
  const [currentFile, setCurrentFile] = useState<File | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<'editor' | 'xml' | 'json'>('editor');
  
  // View Logic
  const [pendingBankStatementFile, setPendingBankStatementFile] = useState<File | null>(null);

  // Invalid File Alert
  const [invalidFileAlert, setInvalidFileAlert] = useState<{show: boolean, fileName: string, reason: string}>({ show: false, fileName: '', reason: '' });

  // Settings Modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPushing, setIsPushing] = useState(false);

  // Toast
  const [toast, setToast] = useState<{show: boolean, message: string}>({ show: false, message: '' });
  
  // Dark Mode
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('theme');
        return saved === 'dark';
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast({ show: false, message: '' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  // Tally Status
  const [tallyStatus, setTallyStatus] = useState<{online: boolean; msg: string; activeCompany?: string}>({ online: false, msg: 'Connecting...' });

  useEffect(() => {
    checkStatus();
  }, []);

  // Sync currentInvoice
  useEffect(() => {
    if (currentFile) {
        const match = processedFiles.find(f => f.file === currentFile);
        if (match && match.data && match.data !== currentInvoice) {
            setCurrentInvoice(match.data);
        }
    }
  }, [processedFiles, currentFile, currentInvoice]);

  useEffect(() => {
      if (currentView === AppView.EDITOR && !currentInvoice && !currentFile && processedFiles.length > 0) {
          const latest = processedFiles.find(f => f.sourceType === 'OCR_INVOICE');
          if (latest) {
            setCurrentFile(latest.file);
            if (latest.data) {
                setCurrentInvoice(latest.data);
            }
          }
      }
  }, [currentView, processedFiles, currentInvoice, currentFile]);

  const checkStatus = async () => {
      setTallyStatus({ online: false, msg: 'Checking...' });
      const status = await checkTallyConnection();
      setTallyStatus({ 
          online: status.online, 
          msg: status.info,
          activeCompany: status.activeCompany
      });
  };

  const handlePushLog = (status: 'Success' | 'Failed', message: string, response?: string) => {
    const log: LogEntry = {
      id: uuidv4(),
      timestamp: new Date(),
      method: 'POST',
      endpoint: TALLY_API_URL,
      status: status,
      message: message,
      response: response
    };
    setLogs(prev => [log, ...prev]);
    saveLogToDB(log); // SAVE TO MYSQL
    if (status === 'Success') {
      setToast({ show: true, message: message });
    }
  };

  const handleRegisterFile = (file: File, type: 'OCR_INVOICE' | 'BANK_STATEMENT' | 'EXCEL_IMPORT') => {
      const newEntry: ProcessedFile = {
          id: uuidv4(),
          file,
          fileName: file.name,
          sourceType: type,
          status: 'Processing',
          correctEntries: 0,
          incorrectEntries: 0,
          timeTaken: '0 min',
          uploadTimestamp: Date.now()
      };
      setProcessedFiles(prev => [newEntry, ...prev]);
      return newEntry.id;
  };

  const handleUpdateFile = (id: string, updates: Partial<ProcessedFile>) => {
      setProcessedFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const calculateEntryStats = (data: InvoiceData) => {
    let correct = 0;
    let incorrect = 0;
    data.lineItems.forEach(item => {
        if (item.amount !== 0) correct++; else incorrect++;
    });
    return { correct, incorrect };
  };

  const handleBulkUpload = async (files: File[]) => {
      const newEntries: ProcessedFile[] = files.map(file => ({
          id: uuidv4(),
          file,
          fileName: file.name,
          sourceType: 'OCR_INVOICE',
          status: 'Pending',
          correctEntries: 0,
          incorrectEntries: 0,
          timeTaken: '-',
          uploadTimestamp: Date.now()
      }));
      setProcessedFiles(prev => [...newEntries, ...prev]);
      for (const entry of newEntries) {
          await processSingleFile(entry);
      }
  };

  const processSingleFile = async (entry: ProcessedFile) => {
      setProcessedFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'Processing' } : f));
      const start = Date.now();
      try {
          const data = await parseInvoiceWithGemini(entry.file);
          
          if (data.documentType === 'BANK_STATEMENT') {
               throw new Error("File detected as Bank Statement. Please upload in Bank Statement section.");
          }

          const duration = ((Date.now() - start) / 1000 / 60).toFixed(2); 
          const { correct, incorrect } = calculateEntryStats(data);

          setProcessedFiles(prev => prev.map(f => {
              if (f.id === entry.id) {
                  return {
                      ...f,
                      status: 'Ready', 
                      data: data,
                      timeTaken: `${duration} min`,
                      correctEntries: correct,
                      incorrectEntries: incorrect
                  };
              }
              return f;
          }));

          saveInvoiceToDB(data, 'Ready', entry.id); // SAVE TO MYSQL
          setToast({ show: true, message: `${entry.fileName} processed successfully` });

      } catch (error) {
           const duration = ((Date.now() - start) / 1000 / 60).toFixed(2);
           let errorMsg = error instanceof Error ? error.message : "Processing Failed";
           
           // Error handling logic...
           if (errorMsg.includes("The document has no pages")) {
               errorMsg = "Empty or Corrupted File";
               setInvalidFileAlert({ show: true, fileName: entry.fileName, reason: "File empty/corrupted." });
           }

           setProcessedFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'Failed', error: errorMsg, timeTaken: `${duration} min` } : f));
           
           const failLog: LogEntry = {
               id: uuidv4(),
               timestamp: new Date(),
               method: 'POST',
               endpoint: 'GEMINI_API',
               status: 'Failed',
               message: `OCR Failed for ${entry.fileName}: ${errorMsg}`
           };
           setLogs(prev => [failLog, ...prev]);
           saveLogToDB(failLog); // SAVE LOG TO MYSQL
      }
  };

  const handleRetryFailed = () => {
      const failed = processedFiles.filter(f => (f.status === 'Failed' || f.status === 'Mismatch') && f.sourceType === 'OCR_INVOICE');
      failed.forEach(f => processSingleFile(f));
  };

  const handleViewInvoice = (file: ProcessedFile) => {
      if (file.sourceType === 'BANK_STATEMENT') {
          setCurrentView(AppView.BANK_STATEMENT);
          setPendingBankStatementFile(file.file);
          return;
      }
      if (file.sourceType === 'EXCEL_IMPORT') {
          setCurrentView(AppView.EXCEL_IMPORT);
          return;
      }
      if (file.data) {
          setCurrentInvoice(file.data);
          setCurrentFile(file.file);
          setCurrentView(AppView.EDITOR);
          setActiveTab('editor');
      }
  };

  const handleSaveInvoice = (data: InvoiceData, switchTab: boolean = true) => {
    setCurrentInvoice(data);
    if (switchTab) setActiveTab('xml');
    else setToast({ show: true, message: "Invoice updated successfully" });

    if (currentFile) {
        const { correct, incorrect } = calculateEntryStats(data);
        const fileEntry = processedFiles.find(f => f.file === currentFile);
        
        setProcessedFiles(prev => prev.map(f => f.file === currentFile ? { ...f, data, correctEntries: correct, incorrectEntries: incorrect } : f));
        
        if (fileEntry) saveInvoiceToDB(data, fileEntry.status, fileEntry.id); // UPDATE MYSQL
    }
  };

  const handleNavigateInvoice = (direction: 'next' | 'prev') => {
      const currentIndex = processedFiles.findIndex(f => f.file === currentFile);
      if (currentIndex === -1) return;
      const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (newIndex >= 0 && newIndex < processedFiles.length) {
          const nextFile = processedFiles[newIndex];
          if (nextFile.sourceType === 'OCR_INVOICE' && nextFile.data) handleViewInvoice(nextFile);
      }
  };

  const handlePushToTally = async (invoiceData?: InvoiceData) => {
    const targetInvoice = invoiceData || currentInvoice;
    if (!targetInvoice) return;
    const fileEntry = processedFiles.find(f => f.file === currentFile);
    await performPush(targetInvoice, fileEntry?.id);
  };

  const performPush = async (invoice: InvoiceData, fileId?: string) => {
    setIsPushing(true);
    const newLogId = uuidv4();
    const pendingLog: LogEntry = {
        id: newLogId,
        timestamp: new Date(),
        method: 'POST',
        endpoint: TALLY_API_URL,
        status: 'Pending',
        message: `Pushing Invoice ${invoice.invoiceNumber}...`
    };
    setLogs(prev => [pendingLog, ...prev]);

    try {
        const existingLedgers = await fetchExistingLedgers();
        const xml = generateTallyXml(invoice, existingLedgers);
        const result = await pushToTally(xml);
        
        // Update Log
        const updatedLog: LogEntry = {
            ...pendingLog,
            status: result.success ? 'Success' : 'Failed',
            message: result.success ? `Imported ${invoice.invoiceNumber}` : `Failed: ${invoice.invoiceNumber}`,
            response: result.message
        };

        setLogs(prev => prev.map(l => l.id === newLogId ? updatedLog : l));
        saveLogToDB(updatedLog); // SAVE TO MYSQL

        // Update File Status & DB
        if (fileId) {
             const newStatus = result.success ? 'Success' : 'Failed';
             setProcessedFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: newStatus } : f));
             saveInvoiceToDB(invoice, newStatus, fileId); // SAVE TO MYSQL
        }

    } catch (error) {
        // Handle network error...
        setIsPushing(false);
    } finally {
        setIsPushing(false);
    }
  };

  const handleEditorPush = async (data: InvoiceData) => {
      handleSaveInvoice(data, false);
      await handlePushToTally(data);
  };

  const handleBulkPushToTally = async () => {
      const readyFiles = processedFiles.filter(f => (f.status === 'Ready') && f.data && f.sourceType === 'OCR_INVOICE');
      if (readyFiles.length === 0) return;
      setIsPushing(true);
      for (const file of readyFiles) {
          if (file.data) {
              await performPush(file.data, file.id);
              await new Promise(resolve => setTimeout(resolve, 500));
          }
      }
      setIsPushing(false);
  };

  const handleDownload = (file: ProcessedFile) => {
      if (!file.data) return;
      const reportText = JSON.stringify(file.data, null, 2);
      const blob = new Blob([reportText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.fileName.split('.')[0]}_data.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const filteredFiles = processedFiles.filter(f => {
      const term = searchTerm.toLowerCase().trim();
      let matchesSearch = f.fileName.toLowerCase().includes(term);
      if (!matchesSearch && f.data) {
        matchesSearch = (
            (f.data.invoiceNumber || '').toLowerCase().includes(term) ||
            (f.data.supplierName || '').toLowerCase().includes(term)
        );
      }
      let matchesFilter = false;
      if (filterStatus === 'All') matchesFilter = true;
      else if (['Success', 'Ready', 'Failed', 'Processing'].includes(filterStatus)) matchesFilter = f.status === filterStatus;
      else if (['Invoices', 'Bank', 'Excel'].includes(filterStatus)) {
          if (filterStatus === 'Invoices') matchesFilter = f.sourceType === 'OCR_INVOICE';
          if (filterStatus === 'Bank') matchesFilter = f.sourceType === 'BANK_STATEMENT';
          if (filterStatus === 'Excel') matchesFilter = f.sourceType === 'EXCEL_IMPORT';
      }
      return matchesSearch && matchesFilter;
  });

  const currentIndex = processedFiles.findIndex(f => f.file === currentFile);
  const totalInvoices = processedFiles.filter(f => f.sourceType === 'OCR_INVOICE').length;

  // View Routing Logic
  const renderContent = () => {
      if (currentView === AppView.DASHBOARD) return (
          <Dashboard 
            files={filteredFiles} 
            onNavigateToUpload={() => setCurrentView(AppView.UPLOAD)}
            onRetry={handleRetryFailed}
            onView={handleViewInvoice}
            onPushSuccess={handleBulkPushToTally}
            isPushing={isPushing}
            onDownload={handleDownload}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            filterStatus={filterStatus}
            onFilterChange={setFilterStatus}
          />
      );
      if (currentView === AppView.UPLOAD) return (
          <InvoiceUpload 
            onFilesSelected={(files) => {
                handleBulkUpload(files);
                if (files.length > 0) { setCurrentFile(files[0]); setCurrentInvoice(null); setCurrentView(AppView.EDITOR); }
                else setCurrentView(AppView.DASHBOARD);
            }}
            onRestoreDraft={(data) => {
                handleSaveInvoice(data, false); setActiveTab('editor'); setCurrentView(AppView.EDITOR);
                setToast({ show: true, message: "Draft restored" });
            }}
          />
      );
      if (currentView === AppView.EDITOR) {
          if (!currentInvoice) return (
             <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <FileText className="w-16 h-16 mb-4 opacity-50" />
                <p>No Invoice Selected</p>
                <button onClick={() => setCurrentView(AppView.DASHBOARD)} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded">Go to Dashboard</button>
             </div>
          );
          return (
             <div className="h-full flex flex-col">
                 <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-2 flex gap-2">
                     <button onClick={() => setActiveTab('editor')} className={`px-4 py-1 rounded ${activeTab==='editor'?'bg-indigo-100 text-indigo-700':''}`}>Editor</button>
                     <button onClick={() => setActiveTab('xml')} className={`px-4 py-1 rounded ${activeTab==='xml'?'bg-indigo-100 text-indigo-700':''}`}>XML</button>
                     <button onClick={() => setActiveTab('json')} className={`px-4 py-1 rounded ${activeTab==='json'?'bg-indigo-100 text-indigo-700':''}`}>JSON</button>
                 </div>
                 <div className="flex-1 overflow-hidden">
                    {activeTab === 'editor' && <InvoiceEditor 
                        data={currentInvoice} file={currentFile} onSave={handleSaveInvoice} onPush={handleEditorPush} isPushing={isPushing}
                        currentIndex={currentIndex} totalCount={totalInvoices}
                        onNext={() => handleNavigateInvoice('next')} onPrev={() => handleNavigateInvoice('prev')}
                        hasNext={currentIndex < processedFiles.length -1} hasPrev={currentIndex > 0}
                    />}
                    {activeTab === 'xml' && <XmlViewer data={currentInvoice} />}
                    {activeTab === 'json' && <JsonViewer data={currentInvoice} />}
                 </div>
             </div>
          );
      }
      if (currentView === AppView.BANK_STATEMENT) return (
          <BankStatementManager 
            onPushLog={handlePushLog} externalFile={pendingBankStatementFile} 
            onRegisterFile={(f) => handleRegisterFile(f, 'BANK_STATEMENT')}
            onUpdateFile={handleUpdateFile}
          />
      );
      if (currentView === AppView.EXCEL_IMPORT) return (
          <ExcelImportManager 
            onPushLog={handlePushLog}
            onRegisterFile={(f) => handleRegisterFile(f, 'EXCEL_IMPORT')}
            onUpdateFile={handleUpdateFile}
          />
      );
      if (currentView === AppView.CHAT) return <ChatBot />;
      if (currentView === AppView.IMAGE_ANALYSIS) return <ImageAnalyzer />;
      if (currentView === AppView.LOGS) return <TallyLogs logs={logs} />;
      return null;
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200 relative">
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
      
      {invalidFileAlert.show && <InvalidFileModal fileName={invalidFileAlert.fileName} reason={invalidFileAlert.reason} onClose={() => setInvalidFileAlert({ show: false, fileName: '', reason: '' })} />}
      
      <Navbar 
        currentView={currentView} onChangeView={setCurrentView} darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)}
        tallyStatus={tallyStatus} onCheckStatus={checkStatus} searchTerm={searchTerm} onSearchChange={setSearchTerm} onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <main className="flex-1 overflow-hidden relative p-4 md:p-6 lg:p-8">
            {renderContent()}
            {toast.show && (
                <div className="fixed bottom-6 right-6 z-[100] animate-fade-in bg-white dark:bg-slate-800 border-l-4 border-green-500 shadow-xl rounded-lg p-4 flex items-center gap-3 pr-8 min-w-[300px]">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <div><h4 className="font-bold text-sm">Success</h4><p className="text-xs text-slate-500">{toast.message}</p></div>
                    <button onClick={() => setToast({show: false, message: ''})} className="absolute top-2 right-2"><X className="w-3 h-3" /></button>
                </div>
            )}
      </main>
    </div>
  );
};

export default App;
