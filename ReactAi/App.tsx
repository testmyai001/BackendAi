
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
import Navbar from './components/Navbar';
import InvalidFileModal from './components/InvalidFileModal';
import { InvoiceData, LogEntry, AppView, ProcessedFile } from './types';
import { ArrowRight, Loader2, CheckCircle2, X, FileText, Landmark, AlertTriangle } from 'lucide-react';
import { generateTallyXml, pushToTally, fetchExistingLedgers, checkTallyConnection } from './services/tallyService';
import { parseInvoiceWithGemini } from './services/backendService';
import { TALLY_API_URL } from './constants';
import { v4 as uuidv4 } from 'uuid';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  
  // Bulk Processing State
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  
  // Currently Active Invoice (for Editor)
  const [currentInvoice, setCurrentInvoice] = useState<InvoiceData | null>(null);
  const [currentFile, setCurrentFile] = useState<File | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<'editor' | 'xml' | 'json'>('editor');
  
  // Inter-module File Passing (Redirect Logic)
  const [pendingBankStatementFile, setPendingBankStatementFile] = useState<File | null>(null);
  const [mismatchedFileAlert, setMismatchedFileAlert] = useState<{show: boolean, file: ProcessedFile | null}>({ show: false, file: null });

  // Invalid File Alert Logic
  const [invalidFileAlert, setInvalidFileAlert] = useState<{show: boolean, fileName: string, reason: string}>({ show: false, fileName: '', reason: '' });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPushing, setIsPushing] = useState(false);

  // Toast State
  const [toast, setToast] = useState<{show: boolean, message: string}>({ show: false, message: '' });
  
  // Dark Mode State
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('theme');
        return saved === 'dark';
    }
    return false;
  });

  // Apply Dark Mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  // Toast Timer
  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast({ show: false, message: '' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  // Tally Connection State
  const [tallyStatus, setTallyStatus] = useState<{online: boolean; msg: string; mode: 'full' | 'blind' | 'none'}>({ online: false, msg: 'Connecting...', mode: 'none' });

  // Initial Connection Check
  useEffect(() => {
    checkStatus();
  }, []);

  // --- Auto-Selection & Sync Logic ---

  // 1. Sync currentInvoice when processing finishes (or updates) for the selected file
  useEffect(() => {
    if (currentFile) {
        const match = processedFiles.find(f => f.file === currentFile);
        // If we found the file entry and it has data (OCR finished), sync it
        if (match && match.data && match.data !== currentInvoice) {
            setCurrentInvoice(match.data);
        }
    }
  }, [processedFiles, currentFile, currentInvoice]);

  // 2. Auto-select latest invoice when entering Editor view if none is active
  useEffect(() => {
      if (currentView === AppView.EDITOR && !currentInvoice && !currentFile && processedFiles.length > 0) {
          const latest = processedFiles[0]; // Most recent based on prepend logic
          setCurrentFile(latest.file);
          if (latest.data) {
              setCurrentInvoice(latest.data);
          }
      }
  }, [currentView, processedFiles, currentInvoice, currentFile]);

  const checkStatus = async () => {
      setTallyStatus({ online: false, msg: 'Checking...', mode: 'none' });
      
      const status = await checkTallyConnection();
      
      setTallyStatus({ 
          online: status.online, 
          msg: status.info,
          mode: status.mode
      });
      
      const log: LogEntry = {
          id: uuidv4(),
          timestamp: new Date(),
          method: 'GET',
          endpoint: TALLY_API_URL,
          status: status.online ? 'Success' : 'Failed',
          message: `Tally Connection Status: ${status.info}`,
          response: status.online 
            ? (status.mode === 'full' ? 'Full Read/Write Access' : 'Port Open (Connected). Push via Simple POST enabled.') 
            : `Connection Failed: ${status.info}. Check Ngrok/Port 9000.`
      };
      setLogs(prev => [log, ...prev]);
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
    if (status === 'Success') {
      setToast({ show: true, message: message });
    }
  };

  // Helper to calculate correct/incorrect entries based on Field Validation
  const calculateEntryStats = (data: InvoiceData) => {
    let correct = 0;
    let incorrect = 0;
    
    // LENIENT MODE:
    // User requested that missing Company/Party names or GST should NOT be considered failures.
    // We only count Line Items for the "Correct/Incorrect" entries statistics.
    // If a line item has 0 amount, it is incorrect. Otherwise correct.
    
    data.lineItems.forEach(item => {
        if (item.amount !== 0) {
            correct++;
        } else {
            incorrect++;
        }
    });

    // If there are no line items at all, and it's an invoice, maybe 1 warning?
    // But let's keep it neutral (0/0) if empty to avoid scary red numbers unless explicitly wrong.
    
    return { correct, incorrect };
  };

  // --- Bulk Upload Logic ---
  const handleBulkUpload = async (files: File[]) => {
      // 1. Initialize placeholders
      const newEntries: ProcessedFile[] = files.map(file => ({
          id: uuidv4(),
          file,
          fileName: file.name,
          status: 'Pending',
          correctEntries: 0,
          incorrectEntries: 0,
          timeTaken: '-',
          uploadTimestamp: Date.now()
      }));

      // Prepend new files so they appear first (index 0)
      setProcessedFiles(prev => [...newEntries, ...prev]);

      // 2. Process in parallel batches of 3 files at a time for 3x speed improvement
      // This balances speed (parallel) with reliability (not overloading backend)
      const batchSize = 3;
      for (let i = 0; i < newEntries.length; i += batchSize) {
          const batch = newEntries.slice(i, i + batchSize);
          // Process batch in parallel
          await Promise.all(batch.map(entry => processSingleFile(entry)));
      }
  };

  const processSingleFile = async (entry: ProcessedFile) => {
      setProcessedFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'Processing' } : f));
      
      const start = Date.now();
      try {
          const data = await parseInvoiceWithGemini(entry.file);
          
          // DETECT TYPE MISMATCH
          if (data.documentType === 'BANK_STATEMENT') {
               setProcessedFiles(prev => prev.map(f => {
                   if (f.id === entry.id) {
                       return {
                           ...f,
                           status: 'Mismatch',
                           error: "Detected as Bank Statement",
                           timeTaken: "0",
                           correctEntries: 0,
                           incorrectEntries: 0
                       };
                   }
                   return f;
               }));
               
               // Show Alert
               setMismatchedFileAlert({
                   show: true,
                   file: { ...entry, status: 'Mismatch', data: data }
               });
               return; // Stop processing this file as an invoice
          }

          const duration = ((Date.now() - start) / 1000 / 60).toFixed(2); // in mins

          // Calculate Field Stats
          const { correct, incorrect } = calculateEntryStats(data);

          setProcessedFiles(prev => prev.map(f => {
              if (f.id === entry.id) {
                  return {
                      ...f,
                      status: 'Ready', // Mark as Ready for OCR (Waiting for Push)
                      data: data,
                      timeTaken: `${duration} min`,
                      correctEntries: correct,
                      incorrectEntries: incorrect
                  };
              }
              return f;
          }));

          // Show Toast Popup
          setToast({ show: true, message: `${entry.fileName} processed successfully` });

      } catch (error) {
           const duration = ((Date.now() - start) / 1000 / 60).toFixed(2);
           let errorMsg = error instanceof Error ? error.message : "Processing Failed";

           // Handle "The document has no pages" error specifically
           if (errorMsg.includes("The document has no pages")) {
               errorMsg = "Empty or Corrupted File";
               setInvalidFileAlert({ 
                   show: true, 
                   fileName: entry.fileName, 
                   reason: "The uploaded file appears to be empty or corrupted (0 pages found). Please check the file and try again." 
               });
           }

           // Handle "Invalid File" error (from Gemini Service)
           if (errorMsg.includes("Invalid File")) {
                setInvalidFileAlert({
                    show: true,
                    fileName: entry.fileName,
                    reason: "The content of this file does not appear to be a valid Invoice or Bank Statement."
                });
           }

           setProcessedFiles(prev => prev.map(f => {
              if (f.id === entry.id) {
                  return {
                      ...f,
                      status: 'Failed',
                      error: errorMsg,
                      timeTaken: `${duration} min`,
                      correctEntries: 0,
                      incorrectEntries: 0
                  };
              }
              return f;
          }));
      }
  };

  // --- REDIRECT LOGIC ---
  const handleSwitchToBankStatement = () => {
      const fileToMove = mismatchedFileAlert.file;
      if (fileToMove) {
          // 1. Remove from processed files list
          setProcessedFiles(prev => prev.filter(f => f.id !== fileToMove.id));
          
          // 2. Set as pending for Bank Statement
          setPendingBankStatementFile(fileToMove.file);
          
          // 3. Switch View
          setCurrentView(AppView.BANK_STATEMENT);
          setMismatchedFileAlert({ show: false, file: null });
      }
  };
  
  const handleRedirectToInvoice = (file: File) => {
      // Logic when Bank Statement Manager sends a file back
      setCurrentView(AppView.DASHBOARD);
      handleBulkUpload([file]);
  };

  const handleRetryFailed = () => {
      const failed = processedFiles.filter(f => f.status === 'Failed' || f.status === 'Mismatch');
      failed.forEach(f => processSingleFile(f));
  };

  const handleViewInvoice = (file: ProcessedFile) => {
      if (file.status === 'Mismatch') {
          // Re-trigger mismatch alert if user clicks view on a mismatched file
          setMismatchedFileAlert({ show: true, file });
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
    if (switchTab) {
        setActiveTab('xml');
    } else {
        // Show success message if staying on the same tab
        setToast({ show: true, message: "Invoice updated successfully" });
    }

    // SYNC: Update the processedFiles list so the main table/bulk push has the edited data
    if (currentFile) {
        // Recalculate stats based on edited data
        const { correct, incorrect } = calculateEntryStats(data);

        setProcessedFiles(prev => prev.map(f => {
            if (f.file === currentFile) {
                return { 
                    ...f, 
                    data: data,
                    correctEntries: correct,
                    incorrectEntries: incorrect
                };
            }
            return f;
        }));
    }
  };

  // --- Navigation Logic for Editor Wizard ---
  const getCurrentIndex = () => {
      return processedFiles.findIndex(f => f.file === currentFile);
  };

  const handleNavigateInvoice = (direction: 'next' | 'prev') => {
      const currentIndex = getCurrentIndex();
      if (currentIndex === -1) return;

      const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      
      // Bounds check
      if (newIndex >= 0 && newIndex < processedFiles.length) {
          const nextFile = processedFiles[newIndex];
          if (nextFile.data) {
             handleViewInvoice(nextFile);
          } else {
             // If next file failed or processing, just set the file and view
             // The view logic will handle displaying "Processing" or "Failed"
             setCurrentFile(nextFile.file);
             setCurrentInvoice(nextFile.data || null); // null if not ready
          }
      }
  };

  const handlePushToTally = async (invoiceData?: InvoiceData) => {
    const targetInvoice = invoiceData || currentInvoice;
    if (!targetInvoice) return;
    
    // Find the file ID associated with this invoice to update stats
    const fileEntry = processedFiles.find(f => f.file === currentFile);
    await performPush(targetInvoice, fileEntry?.id);
  };

  // Shared Push Logic
  const performPush = async (invoice: InvoiceData, fileId?: string) => {
    setIsPushing(true);
    
    const newLogId = uuidv4();
    const timestamp = new Date();

    // Log Initiation
    const pendingLog: LogEntry = {
        id: newLogId,
        timestamp,
        method: 'POST',
        endpoint: TALLY_API_URL,
        status: 'Pending',
        message: `Checking Ledgers & Pushing Invoice ${invoice.invoiceNumber}...`
    };
    setLogs(prev => [pendingLog, ...prev]);

    try {
        // 1. Check existing ledgers to avoid duplicates
        const existingLedgers = await fetchExistingLedgers();
        
        // 2. Generate XML with exclusion list
        const xml = generateTallyXml(invoice, existingLedgers);

        // 3. Push to Tally
        const result = await pushToTally(xml);
        
        setLogs(prev => prev.map(log => {
            if (log.id === newLogId) {
                return {
                    ...log,
                    status: result.success ? 'Success' : 'Failed',
                    message: result.success ? `Imported ${invoice.invoiceNumber} (${invoice.invoiceDate})` : `Failed: ${invoice.invoiceNumber}`,
                    response: result.message
                };
            }
            return log;
        }));

        // UPDATE STATUS ONLY: Entries count is determined by data quality, not push status.
        if (fileId) {
             setProcessedFiles(prev => prev.map(f => {
                 if (f.id === fileId) {
                     return {
                         ...f,
                         status: result.success ? 'Success' : 'Failed',
                         // We preserve correctEntries/incorrectEntries as calculated from data
                     };
                 }
                 return f;
             }));
        }

    } catch (error) {
         setLogs(prev => prev.map(log => {
            if (log.id === newLogId) {
                return {
                    ...log,
                    status: 'Failed',
                    message: 'Network/Tunnel Error',
                    response: 'Ensure Ngrok tunnel is running and Tally is open on port 9000.'
                };
            }
            return log;
        }));
        
        // Mark status as Failed
        if (fileId) {
             setProcessedFiles(prev => prev.map(f => {
                 if (f.id === fileId) {
                     return { ...f, status: 'Failed' };
                 }
                 return f;
             }));
        }
    } finally {
        setIsPushing(false);
    }
  };

  const handleEditorPush = async (data: InvoiceData) => {
      // Save data but don't switch tab
      handleSaveInvoice(data, false);
      await handlePushToTally(data);
  };

  const handleBulkPushToTally = async () => {
      // Push all ready invoices (OCR Success)
      const readyFiles = processedFiles.filter(f => (f.status === 'Ready') && f.data);
      
      if (readyFiles.length === 0) return;

      setIsPushing(true);
      for (const file of readyFiles) {
          if (file.data) {
              await performPush(file.data, file.id);
              // Small delay to prevent network congestion
              await new Promise(resolve => setTimeout(resolve, 500));
          }
      }
      setIsPushing(false);
  };

  // Generate a plain text report for the invoice
  const generateInvoiceReport = (data: InvoiceData): string => {
    let report = `INVOICE REPORT\n`;
    report += `=========================================\n`;
    report += `Invoice Number : ${data.invoiceNumber || 'N/A'}\n`;
    report += `Invoice Date   : ${data.invoiceDate || 'N/A'}\n`;
    report += `Voucher Type   : ${data.voucherType}\n`;
    report += `-----------------------------------------\n`;
    report += `SUPPLIER\n`;
    report += `Name  : ${data.supplierName || 'N/A'}\n`;
    report += `GSTIN : ${data.supplierGstin || 'N/A'}\n`;
    report += `-----------------------------------------\n`;
    report += `BUYER\n`;
    report += `Name  : ${data.buyerName || 'N/A'}\n`;
    report += `GSTIN : ${data.buyerGstin || 'N/A'}\n`;
    report += `-----------------------------------------\n`;
    report += `LINE ITEMS\n`;
    report += `-----------------------------------------\n`;
    
    data.lineItems.forEach((item, index) => {
      report += `#${index + 1} ${item.description || 'Item'}\n`;
      report += `    HSN: ${item.hsn || '-'} | Qty: ${item.quantity} | Rate: ${item.rate}\n`;
      report += `    Taxable: ${item.amount} | GST: ${item.gstRate}%\n`;
      report += `-----------------------------------------\n`;
    });

    // Calculate totals for report
    const taxable = data.lineItems.reduce((sum, item) => sum + (Number(item.amount)||0), 0);
    const tax = data.lineItems.reduce((sum, item) => sum + ((Number(item.amount)||0) * (Number(item.gstRate)||0) / 100), 0);
    const total = taxable + tax;

    report += `SUMMARY\n`;
    report += `Total Taxable : ${taxable.toFixed(2)}\n`;
    report += `Total Tax     : ${tax.toFixed(2)}\n`;
    report += `GRAND TOTAL   : ${total.toFixed(2)}\n`;
    report += `=========================================\n`;
    report += `Generated by AutoTally AI\n`;
    
    return report;
  };

  const handleDownload = (file: ProcessedFile) => {
      if (!file.data) return;
      const reportText = generateInvoiceReport(file.data);
      const blob = new Blob([reportText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.fileName.split('.')[0]}_report.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  // Filter Logic
  const filteredFiles = processedFiles.filter(f => {
      const term = searchTerm.toLowerCase().trim();
      
      // 1. Search in file name
      let matchesSearch = f.fileName.toLowerCase().includes(term);

      // 2. Deep Search inside data if available
      if (!matchesSearch && f.data) {
        matchesSearch = (
            (f.data.invoiceNumber || '').toLowerCase().includes(term) ||
            (f.data.supplierName || '').toLowerCase().includes(term) ||
            (f.data.buyerName || '').toLowerCase().includes(term) ||
            (f.data.invoiceDate || '').toLowerCase().includes(term) ||
            // Search Voucher Type string
            (f.data.voucherType || '').toLowerCase().includes(term) ||
            // Search Line Items
            (f.data.lineItems || []).some(item => 
                (item.description || '').toLowerCase().includes(term) ||
                (item.amount || 0).toString().includes(term)
            )
        );
      }

      // Filter Logic
      let matchesFilter = false;
      
      if (filterStatus === 'All') {
          matchesFilter = true;
      } else if (['Success', 'Ready', 'Failed', 'Processing', 'Pending'].includes(filterStatus)) {
          matchesFilter = f.status === filterStatus;
      } else if (['Sales', 'Purchase'].includes(filterStatus)) {
          // Filter by Voucher Type
          matchesFilter = f.data?.voucherType === filterStatus;
      }
      
      return matchesSearch && matchesFilter;
  });

  const currentIndex = getCurrentIndex();
  const totalInvoices = processedFiles.length;

  // Render logic for Editor View to keep App component clean
  const renderEditorContent = () => {
    const activeFileEntry = currentFile ? processedFiles.find(f => f.file === currentFile) : null;
    const isProcessingCurrent = activeFileEntry && (activeFileEntry.status === 'Processing' || activeFileEntry.status === 'Pending');

    if (isProcessingCurrent) {
         return (
            <div className="flex flex-col items-center justify-center h-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm animate-fade-in">
                <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-full mb-4">
                   <Loader2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400 animate-spin" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Processing Invoice...</h3>
                <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-sm text-center">
                  AI is extracting data from <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{activeFileEntry?.fileName}</span>
                </p>
                <p className="text-xs text-slate-400 mt-6">This usually takes 5-10 seconds.</p>
            </div>
         );
    }

    return currentInvoice ? (
       <div id="editor-container" className="animate-fade-in flex flex-col h-full gap-4">
           {/* Toolbar */}
           <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-4">
                   <button 
                      onClick={() => setCurrentView(AppView.DASHBOARD)}
                      className="p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
                   >
                      <ArrowRight className="w-5 h-5 rotate-180" />
                   </button>
                   <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      Review & Verify
                   </h2>
              </div>
              
              <div className="flex items-center gap-3 bg-white dark:bg-slate-900 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                      <button 
                          onClick={() => setActiveTab('editor')}
                          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'editor' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                      >
                          Editor
                      </button>
                      <button 
                          onClick={() => setActiveTab('xml')}
                          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'xml' ? 'bg-white dark:bg-slate-700 text-tally-700 dark:text-tally-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                      >
                          XML
                      </button>
                       <button 
                          onClick={() => setActiveTab('json')}
                          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'json' ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                      >
                          JSON
                      </button>
                  </div>
              </div>
           </div>

           {/* Content Container - Single View Switch */}
           <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 relative flex flex-col">
               {activeTab === 'editor' && (
                   <InvoiceEditor 
                      data={currentInvoice} 
                      file={currentFile} 
                      onSave={handleSaveInvoice} 
                      onPush={handleEditorPush}
                      isPushing={isPushing}
                      currentIndex={currentIndex}
                      totalCount={totalInvoices}
                      onNext={() => handleNavigateInvoice('next')}
                      onPrev={() => handleNavigateInvoice('prev')}
                      hasNext={currentIndex < totalInvoices - 1}
                      hasPrev={currentIndex > 0}
                   />
               )}
               {activeTab === 'xml' && <XmlViewer data={currentInvoice} />}
               {activeTab === 'json' && <JsonViewer data={currentInvoice} />}
           </div>
        </div>
    ) : (
        <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <FileText className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg font-medium">No Invoice Selected</p>
            <p className="text-sm mt-2">Select an invoice from the Dashboard to review.</p>
            <button onClick={() => setCurrentView(AppView.DASHBOARD)} className="mt-6 px-5 py-2.5 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/20">Go to Dashboard</button>
        </div>
    );
  };

  // Helper function to manage view visibility (Keep Alive)
  // This ensures components are not unmounted when switching views, preserving their state
  const getViewClass = (view: AppView) => {
      // Use absolute positioning with full height to ensure proper layout
      return `absolute inset-0 p-4 md:p-6 lg:p-8 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 ${currentView === view ? 'block z-10' : 'hidden z-0'}`;
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200 relative">
      
      {/* GLOBAL MODAL: Invalid File Alert */}
      {invalidFileAlert.show && (
          <InvalidFileModal 
             fileName={invalidFileAlert.fileName} 
             reason={invalidFileAlert.reason} 
             onClose={() => setInvalidFileAlert({ show: false, fileName: '', reason: '' })} 
          />
      )}

      {/* GLOBAL MODAL: Document Type Mismatch */}
      {mismatchedFileAlert.show && mismatchedFileAlert.file && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-2xl border-2 border-orange-400 max-w-md w-full text-center">
                  <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Landmark className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">Bank Statement Detected!</h3>
                  <p className="text-slate-500 dark:text-slate-400 mt-2 mb-6">
                      You uploaded <span className="font-semibold text-slate-800 dark:text-slate-200">{mismatchedFileAlert.file.fileName}</span> in the Invoice section, but it appears to be a Bank Statement.
                  </p>
                  
                  <div className="flex flex-col gap-3">
                      <button 
                          onClick={handleSwitchToBankStatement}
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg transition-transform hover:-translate-y-1 flex items-center justify-center gap-2"
                      >
                          <ArrowRight className="w-4 h-4" />
                          Process as Bank Statement
                      </button>
                      <button 
                          onClick={() => setMismatchedFileAlert({show: false, file: null})}
                          className="w-full py-3 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-semibold"
                      >
                          Cancel / Delete
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Top Navigation Bar */}
      <Navbar 
        currentView={currentView} 
        onChangeView={setCurrentView}
        darkMode={darkMode}
        toggleDarkMode={() => setDarkMode(!darkMode)}
        tallyStatus={tallyStatus}
        onCheckStatus={checkStatus}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <main className="flex-1 overflow-hidden relative">
            
            {/* 
                KEEP ALIVE STRATEGY:
                Instead of conditional rendering { currentView === ... && <Comp /> },
                We render ALL main views but toggle their visibility using CSS (via hidden class).
                This persists local state (Chat history, Analysis results, Scroll position)
                when switching tabs.
            */}

            {/* DASHBOARD */}
            <div className={getViewClass(AppView.DASHBOARD)}>
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
            </div>

            {/* UPLOAD */}
            <div className={getViewClass(AppView.UPLOAD)}>
                 <InvoiceUpload 
                    onFilesSelected={(files) => {
                        handleBulkUpload(files);
                        // Trigger redirect to editor for the first uploaded file
                        if (files.length > 0) {
                            setCurrentFile(files[0]);
                            setCurrentInvoice(null); // Clear until processing finishes
                            setCurrentView(AppView.EDITOR);
                        } else {
                            setCurrentView(AppView.DASHBOARD);
                        }
                    }}
                    onRestoreDraft={(data) => {
                        handleSaveInvoice(data, false);
                        setActiveTab('editor');
                        setCurrentView(AppView.EDITOR);
                        setToast({ show: true, message: "Draft restored successfully" });
                    }}
                />
            </div>

            {/* EDITOR */}
            <div className={getViewClass(AppView.EDITOR)}>
                {renderEditorContent()}
            </div>

            {/* BANK STATEMENT */}
            <div className={getViewClass(AppView.BANK_STATEMENT)}>
                <BankStatementManager 
                    onPushLog={handlePushLog} 
                    externalFile={pendingBankStatementFile}
                    onRedirectToInvoice={handleRedirectToInvoice}
                />
            </div>

            {/* CHATBOT */}
            <div className={getViewClass(AppView.CHAT)}>
                <ChatBot />
            </div>

            {/* IMAGE ANALYSIS */}
            <div className={getViewClass(AppView.IMAGE_ANALYSIS)}>
                <ImageAnalyzer />
            </div>

            {/* LOGS */}
            <div className={getViewClass(AppView.LOGS)}>
                <TallyLogs logs={logs} />
            </div>

            
            {/* Toast Notification */}
            {toast.show && (
                <div className="fixed bottom-6 right-6 z-[100] animate-fade-in">
                    <div className="bg-white dark:bg-slate-800 border-l-4 border-green-500 shadow-xl rounded-lg p-4 flex items-center gap-3 pr-8 min-w-[300px]">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <div>
                            <h4 className="font-bold text-sm text-slate-900 dark:text-white">Success</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{toast.message}</p>
                        </div>
                        <button onClick={() => setToast({show: false, message: ''})} className="absolute top-2 right-2 text-slate-400 hover:text-slate-600">
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            )}
        </main>
      </div>
    </div>
  );
};

export default App;
