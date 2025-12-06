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
import AuthScreen from './components/AuthScreen';
import { InvoiceData, LogEntry, AppView, ProcessedFile } from './types';
import { ArrowRight, Loader2, CheckCircle2, X, FileText, AlertTriangle } from 'lucide-react';
import { generateTallyXml, pushToTally, fetchExistingLedgers, checkTallyConnection } from './services/tallyService';
import { parseInvoiceWithGemini } from './services/geminiService';
import { TALLY_API_URL } from './constants';
import { v4 as uuidv4 } from 'uuid';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  
  const [currentInvoice, setCurrentInvoice] = useState<InvoiceData | null>(null);
  const [currentFile, setCurrentFile] = useState<File | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<'editor' | 'xml' | 'json'>('editor');
  
  const [pendingBankStatementFile, setPendingBankStatementFile] = useState<File | null>(null);
  const [invalidFileAlert, setInvalidFileAlert] = useState<{show: boolean, fileName: string, reason: string}>({ show: false, fileName: '', reason: '' });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPushing, setIsPushing] = useState(false);
  const [toast, setToast] = useState<{show: boolean, message: string}>({ show: false, message: '' });
  
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      return saved === 'dark';
    }
    return false;
  });

  const [tallyStatus, setTallyStatus] = useState<{online: boolean; msg: string}>({ online: false, msg: 'Checking...' });

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

  useEffect(() => {
    if (isAuthenticated) checkStatus();
  }, [isAuthenticated]);

  useEffect(() => {
    if (currentFile) {
      const match = processedFiles.find((f) => f.file === currentFile);
      if (match && match.data && match.data !== currentInvoice) {
        setCurrentInvoice(match.data);
      }
    }
  }, [processedFiles, currentFile, currentInvoice]);

  useEffect(() => {
    if (currentView === AppView.EDITOR && !currentInvoice && !currentFile && processedFiles.length > 0) {
      const latest = processedFiles[0];
      setCurrentFile(latest.file);
      if (latest.data) setCurrentInvoice(latest.data);
    }
  }, [currentView, processedFiles, currentInvoice, currentFile]);

  const checkStatus = async () => {
    setTallyStatus({ online: false, msg: 'Checking...' });
    const status = await checkTallyConnection();
    setTallyStatus({ online: status.online, msg: status.info });
  };

  const handlePushLog = (status: 'Success' | 'Failed', message: string, response?: string) => {
    const log: LogEntry = {
      id: uuidv4(),
      timestamp: new Date(),
      method: 'POST',
      endpoint: TALLY_API_URL,
      status: status,
      message: message,
      response: response,
    };
    setLogs((prev) => [log, ...prev]);
    if (status === 'Success') setToast({ show: true, message: message });
  };

  const calculateEntryStats = (data: InvoiceData) => {
    let correct = 0, incorrect = 0;
    data.lineItems.forEach((item) => { if (item.amount !== 0) correct++; else incorrect++; });
    return { correct, incorrect };
  };

  const handleBulkUpload = async (files: File[]) => {
    const newEntries: ProcessedFile[] = files.map((file) => ({ id: uuidv4(), file, fileName: file.name, status: 'Pending', sourceType: 'OCR_INVOICE', correctEntries: 0, incorrectEntries: 0, timeTaken: '-', uploadTimestamp: Date.now() }));
    setProcessedFiles((prev) => [...newEntries, ...prev]);
    const batchSize = 3;
    for (let i = 0; i < newEntries.length; i += batchSize) {
      const batch = newEntries.slice(i, i + batchSize);
      await Promise.all(batch.map((entry) => processSingleFile(entry)));
    }
  };

  const processSingleFile = async (entry: ProcessedFile) => {
    setProcessedFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, status: 'Processing' } : f)));
    const start = Date.now();
    try {
      const data = await parseInvoiceWithGemini(entry.file);
      if (data.documentType === 'BANK_STATEMENT') {
        setProcessedFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, status: 'Mismatch', error: 'Detected as Bank Statement' } : f));
        return;
      }
      const duration = ((Date.now() - start) / 1000 / 60).toFixed(2);
      const { correct, incorrect } = calculateEntryStats(data);
      setProcessedFiles((prev) => prev.map((f) => {
        if (f.id === entry.id) return { ...f, status: 'Ready', data: data, timeTaken: `${duration} min`, correctEntries: correct, incorrectEntries: incorrect };
        return f;
      }));
      setToast({ show: true, message: `${entry.fileName} processed successfully` });
    } catch (error) {
      const duration = ((Date.now() - start) / 1000 / 60).toFixed(2);
      let errorMsg = error instanceof Error ? error.message : 'Processing Failed';
      if (errorMsg.includes('The document has no pages')) {
        errorMsg = 'Empty or Corrupted File';
        setInvalidFileAlert({ show: true, fileName: entry.fileName, reason: 'The uploaded file appears to be empty or corrupted (0 pages found). Please check the file and try again.' });
      }
      setProcessedFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, status: 'Failed', error: errorMsg, timeTaken: `${duration} min` } : f));
    }
  };

  const handleRetryFailed = () => { const failed = processedFiles.filter((f) => f.status === 'Failed' || f.status === 'Mismatch'); failed.forEach((f) => processSingleFile(f)); };
  const handleViewInvoice = (file: ProcessedFile) => { if (file.status === 'Mismatch') return; if (file.data) { setCurrentInvoice(file.data); setCurrentFile(file.file); setCurrentView(AppView.EDITOR); setActiveTab('editor'); } };
  const handleSaveInvoice = (data: InvoiceData, switchTab: boolean = true) => { setCurrentInvoice(data); if (switchTab) setActiveTab('xml'); else setToast({ show: true, message: 'Invoice updated successfully' }); if (currentFile) { const { correct, incorrect } = calculateEntryStats(data); setProcessedFiles((prev) => prev.map((f) => f.file === currentFile ? { ...f, data: data, correctEntries: correct, incorrectEntries: incorrect } : f)); } };
  const getCurrentIndex = () => processedFiles.findIndex((f) => f.file === currentFile);
  const handleNavigateInvoice = (direction: 'next' | 'prev') => { const currentIndex = getCurrentIndex(); if (currentIndex === -1) return; const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1; if (newIndex >= 0 && newIndex < processedFiles.length) { const nextFile = processedFiles[newIndex]; if (nextFile.data) handleViewInvoice(nextFile); else { setCurrentFile(nextFile.file); setCurrentInvoice(nextFile.data || null); } } };

  const handlePushToTally = async (invoiceData?: InvoiceData) => { const targetInvoice = invoiceData || currentInvoice; if (!targetInvoice) return; const fileEntry = processedFiles.find((f) => f.file === currentFile); await performPush(targetInvoice, fileEntry?.id); };
  
  const performPush = async (invoice: InvoiceData, fileId?: string) => {
    setIsPushing(true);
    const newLogId = uuidv4();
    const pendingLog: LogEntry = { id: newLogId, timestamp: new Date(), method: 'POST', endpoint: TALLY_API_URL, status: 'Pending', message: `Pushing Invoice ${invoice.invoiceNumber}...` };
    setLogs((prev) => [pendingLog, ...prev]);
    try {
      const existingLedgers = await fetchExistingLedgers();
      const xml = generateTallyXml(invoice, existingLedgers);
      const result = await pushToTally(xml);
      setLogs((prev) => prev.map((log) => { if (log.id === newLogId) return { ...log, status: result.success ? 'Success' : 'Failed', message: result.success ? `Imported ${invoice.invoiceNumber}` : `Failed: ${invoice.invoiceNumber}`, response: result.message }; return log; }));
      if (fileId) setProcessedFiles((prev) => prev.map((f) => f.id === fileId ? { ...f, status: result.success ? 'Success' : 'Failed' } : f));
    } catch (error) {
      setLogs((prev) => prev.map((log) => { if (log.id === newLogId) return { ...log, status: 'Failed', message: 'Network/Tunnel Error', response: 'Ensure tunnel is running and Tally is open.' }; return log; }));
    } finally {
      setIsPushing(false);
    }
  };

  const handleEditorPush = async (data: InvoiceData) => { handleSaveInvoice(data, false); await handlePushToTally(data); };
  const handleBulkPushToTally = async () => { const readyFiles = processedFiles.filter((f) => f.status === 'Ready' && f.data); if (readyFiles.length === 0) return; setIsPushing(true); for (const file of readyFiles) { if (file.data) { await performPush(file.data, file.id); await new Promise((resolve) => setTimeout(resolve, 500)); } } setIsPushing(false); };
  const handleDownload = (file: ProcessedFile) => { if (!file.data) return; const reportText = JSON.stringify(file.data, null, 2); const blob = new Blob([reportText], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${file.fileName.split('.')[0]}_data.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); };
  const handleLock = () => setIsAuthenticated(false);
  
  const filteredFiles = processedFiles.filter((f) => { const term = searchTerm.toLowerCase().trim(); let matchesSearch = f.fileName.toLowerCase().includes(term); if (!matchesSearch && f.data) matchesSearch = (f.data.invoiceNumber || '').toLowerCase().includes(term) || (f.data.supplierName || '').toLowerCase().includes(term) || (f.data.buyerName || '').toLowerCase().includes(term); let matchesFilter = false; if (filterStatus === 'All') matchesFilter = true; else if (['Success', 'Ready', 'Failed', 'Processing', 'Pending'].includes(filterStatus)) matchesFilter = f.status === filterStatus; return matchesSearch && matchesFilter; });
  
  const currentIndex = getCurrentIndex();
  const totalInvoices = processedFiles.length;

  const renderEditorContent = () => {
    const activeFileEntry = currentFile ? processedFiles.find((f) => f.file === currentFile) : null;
    const isProcessingCurrent = activeFileEntry && (activeFileEntry.status === 'Processing' || activeFileEntry.status === 'Pending');
    if (isProcessingCurrent) return (<div className="flex flex-col items-center justify-center h-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm animate-fade-in"><div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-full mb-4"><Loader2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400 animate-spin" /></div><h3 className="text-xl font-bold text-slate-900 dark:text-white">Processing Invoice...</h3><p className="text-slate-500 dark:text-slate-400 mt-2 max-w-sm text-center">AI is extracting data from <span className="font-mono font-medium">${activeFileEntry?.fileName}</span></p></div>);
    return currentInvoice ? (<div className="animate-fade-in flex flex-col h-full gap-4"><div className="shrink-0 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4"><h2 className="text-xl font-bold text-slate-900 dark:text-white">Review & Verify</h2><div className="flex items-center gap-3 bg-white dark:bg-slate-900 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm"><div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1"><button onClick={() => setActiveTab('editor')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'editor' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Editor</button><button onClick={() => setActiveTab('xml')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'xml' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>XML</button><button onClick={() => setActiveTab('json')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'json' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>JSON</button></div></div></div><div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 relative flex flex-col">{activeTab === 'editor' && <InvoiceEditor data={currentInvoice} file={currentFile} onSave={handleSaveInvoice} onPush={handleEditorPush} isPushing={isPushing} currentIndex={currentIndex} totalCount={totalInvoices} onNext={() => handleNavigateInvoice('next')} onPrev={() => handleNavigateInvoice('prev')} hasNext={currentIndex < totalInvoices - 1} hasPrev={currentIndex > 0} />}{activeTab === 'xml' && <XmlViewer data={currentInvoice} />}{activeTab === 'json' && <JsonViewer data={currentInvoice} />}</div></div>) : (<div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700"><FileText className="w-16 h-16 mb-4 opacity-50" /><p className="text-lg font-medium">No Invoice Selected</p><p className="text-sm mt-2">Select an invoice from the Dashboard to review.</p><button onClick={() => setCurrentView(AppView.DASHBOARD)} className="mt-6 px-5 py-2.5 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700">Go to Dashboard</button></div>);
  };

  if (!isAuthenticated) return <AuthScreen onAuthenticated={() => setIsAuthenticated(true)} />;

  return (<div className="flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200 relative">{isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)} />}{invalidFileAlert.show && <InvalidFileModal fileName={invalidFileAlert.fileName} reason={invalidFileAlert.reason} onClose={() => setInvalidFileAlert({ show: false, fileName: '', reason: '' })} />}<Navbar currentView={currentView} onChangeView={setCurrentView} darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)} tallyStatus={tallyStatus} onCheckStatus={checkStatus} searchTerm={searchTerm} onSearchChange={setSearchTerm} onOpenSettings={() => setIsSettingsOpen(true)} onLock={handleLock} /><div className="flex-1 flex flex-col min-w-0 overflow-hidden relative"><main className="flex-1 overflow-hidden relative">{currentView === AppView.DASHBOARD && <div className="absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto"><Dashboard files={filteredFiles} onNavigateToUpload={() => setCurrentView(AppView.UPLOAD)} onRetry={handleRetryFailed} onView={handleViewInvoice} onPushSuccess={handleBulkPushToTally} isPushing={isPushing} onDownload={handleDownload} searchTerm={searchTerm} onSearchChange={setSearchTerm} filterStatus={filterStatus} onFilterChange={setFilterStatus} /></div>}{currentView === AppView.UPLOAD && <div className="absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto"><InvoiceUpload onFilesSelected={(files) => { handleBulkUpload(files); if (files.length > 0) { setCurrentFile(files[0]); setCurrentInvoice(null); setCurrentView(AppView.EDITOR); } else { setCurrentView(AppView.DASHBOARD); } }} onRestoreDraft={(data) => { handleSaveInvoice(data, false); setActiveTab('editor'); setCurrentView(AppView.EDITOR); setToast({ show: true, message: 'Draft restored successfully' }); }} /></div>}{currentView === AppView.EDITOR && <div className="absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto">{renderEditorContent()}</div>}{currentView === AppView.BANK_STATEMENT && <div className="absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto"><BankStatementManager onPushLog={handlePushLog} externalFile={pendingBankStatementFile} /></div>}{currentView === AppView.CHAT && <div className="absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto"><ChatBot /></div>}{currentView === AppView.IMAGE_ANALYSIS && <div className="absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto"><ImageAnalyzer /></div>}{currentView === AppView.EXCEL_IMPORT && <div className="absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto"><ExcelImportManager onPushLog={handlePushLog} /></div>}{currentView === AppView.LOGS && <div className="absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto flex flex-col"><div className="flex-1 flex flex-col min-h-0 h-full"><TallyLogs logs={logs} /></div></div>}{toast.show && <div className="fixed bottom-6 right-6 z-[100] animate-fade-in"><div className="bg-white dark:bg-slate-800 border-l-4 border-green-500 shadow-xl rounded-lg p-4 flex items-center gap-3 pr-8 min-w-[300px]"><CheckCircle2 className="w-5 h-5 text-green-500" /><div><h4 className="font-bold text-sm text-slate-900 dark:text-white">Success</h4><p className="text-xs text-slate-500 dark:text-slate-400">${toast.message}</p></div><button onClick={() => setToast({ show: false, message: '' })} className="absolute top-2 right-2 text-slate-400"><X className="w-3 h-3" /></button></div></div>}</main></div></div>);
};

export default App;
