// frontend/src/components/BankStatementManager.tsx
import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, ArrowRight, Loader2, Trash2, Landmark, Save, History } from 'lucide-react';
import { BankStatementData, BankTransaction, ProcessedFile } from '../types';
import { parseBankStatementWithGemini } from '../services/backendService';
import { generateBankStatementXml, pushToTally, fetchExistingLedgers } from '../services/tallyService';
import { v4 as uuidv4 } from 'uuid';

interface BankStatementManagerProps {
  onPushLog: (status: 'Success' | 'Failed', message: string, response?: string) => void;
  externalFile?: File | null;
  onMismatchDetected?: (file: File, detectedType: 'INVOICE') => void;
  onRegisterFile?: (file: File) => string;
  onUpdateFile?: (id: string, updates: Partial<ProcessedFile>) => void;
}

const BankStatementManager: React.FC<BankStatementManagerProps> = ({
  onPushLog, externalFile, onMismatchDetected, onRegisterFile, onUpdateFile
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [data, setData] = useState<BankStatementData>({ bankName: "HDFC Bank", transactions: [] });
  const [step, setStep] = useState<1 | 2>(1);
  const [isPushing, setIsPushing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showInvoiceAlert, setShowInvoiceAlert] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('autotally_bank_draft');
    setHasDraft(!!saved);
  }, []);

  useEffect(() => {
    if (externalFile) processFile(externalFile);
  }, [externalFile]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
  };

  const processFile = async (uploadedFile: File) => {
    setFile(uploadedFile);
    let currentFileId = null;
    if (onRegisterFile) {
      currentFileId = onRegisterFile(uploadedFile);
      setFileId(currentFileId);
    }

    setIsProcessing(true);
    setShowInvoiceAlert(false);
    const start = Date.now();
    try {
      const result = await parseBankStatementWithGemini(uploadedFile);
      if (result.documentType === 'INVOICE') {
        setShowInvoiceAlert(true);
        setIsProcessing(false);
        if (onUpdateFile && currentFileId) onUpdateFile(currentFileId, { status: 'Mismatch', error: 'Detected as Invoice' });
        
        // Trigger mismatch callback to show modal in App.tsx
        if (onMismatchDetected) {
          onMismatchDetected(uploadedFile, 'INVOICE');
        }
        return;
      }

      const newData = {
        ...data,
        bankName: result.bankName || data.bankName,
        transactions: result.transactions
      };
      setData(newData);
      setStep(2);

      if (onUpdateFile && currentFileId) {
        const duration = ((Date.now() - start) / 1000 / 60).toFixed(2);
        onUpdateFile(currentFileId, {
          status: 'Ready',
          bankData: newData,
          correctEntries: result.transactions.length,
          timeTaken: `${duration} min`
        });
      }
    } catch (error) {
      onPushLog('Failed', 'Bank Statement Parsing Failed', error instanceof Error ? error.message : 'Unknown Error');
      if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed', error: 'Parsing Failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearAlert = () => {
    setFile(null);
    setStep(1);
    setShowInvoiceAlert(false);
  };

  const handleRedirect = () => {
    if (file) {
      onMismatchDetected?.(file, 'INVOICE');
      setFile(null);
      setStep(1);
      setShowInvoiceAlert(false);
    }
  };

  const handleSaveDraft = () => {
    localStorage.setItem('autotally_bank_draft', JSON.stringify(data));
    onPushLog('Success', 'Draft Saved', 'Bank statement draft saved locally.');
    setHasDraft(true);
  };

  const handleRestoreDraft = () => {
    try {
      const saved = localStorage.getItem('autotally_bank_draft');
      if (saved) {
        const parsed = JSON.parse(saved);
        setData(parsed);
        setStep(2);
        onPushLog('Success', 'Draft Restored', 'Loaded draft from storage.');
      }
    } catch (e) { console.error(e); }
  };

  const clearDraft = () => {
    localStorage.removeItem('autotally_bank_draft');
    setHasDraft(false);
  };

  const guessLedgerFromDescription = (desc: string): string => {
    const lower = desc.toLowerCase();
    if (lower.includes('swiggy') || lower.includes('zomato') || lower.includes('mcdonalds') || lower.includes('pizza')) return 'Staff Welfare';
    if (lower.includes('uber') || lower.includes('ola') || lower.includes('fuel') || lower.includes('petrol')) return 'Travelling Expenses';
    if (lower.includes('amazon') || lower.includes('flipkart')) return 'Office Expenses';
    if (lower.includes('airtel') || lower.includes('jio') || lower.includes('vi') || lower.includes('bsnl') || lower.includes('internet')) return 'Telephone & Internet';
    if (lower.includes('electricity') || lower.includes('power') || lower.includes('mse')) return 'Electricity Charges';
    if (lower.includes('rent')) return 'Rent';
    if (lower.includes('interest')) return 'Bank Interest';
    if (lower.includes('charges') || lower.includes('fee')) return 'Bank Charges';
    if (lower.includes('upi') || lower.includes('paytm') || lower.includes('gpay') || lower.includes('phonepe')) return 'UPI Suspense';
    if (lower.includes('neft') || lower.includes('rtgs') || lower.includes('imps') || lower.includes('swift')) return 'Bank Transfers';
    if (lower.includes('salary')) return 'Salary Payable';
    return 'Suspense A/c';
  };

  const handleTransactionChange = (id: string, field: keyof BankTransaction, value: string | number) => {
    setData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, [field]: value } as BankTransaction;
        if (field === 'description' && typeof value === 'string') {
          const currentLedger = t.contraLedger;
          if (!currentLedger || currentLedger === 'Suspense A/c' || currentLedger === 'UPI Suspense') {
            const guessed = guessLedgerFromDescription(value);
            if (guessed !== 'Suspense A/c') updated.contraLedger = guessed;
          }
        }
        return updated;
      })
    }));
  };

  const removeTransaction = (id: string) => {
    setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== id) }));
  };

  const addTransaction = () => {
    setData(prev => ({
      ...prev,
      transactions: [
        ...prev.transactions,
        {
          id: uuidv4(),
          date: new Date().toISOString().slice(0, 10),
          description: 'New Transaction',
          type: 'Payment',
          debit: 0,
          credit: 0,
          voucherType: 'Payment',
          contraLedger: 'Suspense A/c'
        }
      ]
    }));
  };

  const handlePushToTally = async () => {
    setIsPushing(true);
    try {
      const existingLedgers = await fetchExistingLedgers();
      const xml = generateBankStatementXml(data, existingLedgers);
      const result = await pushToTally(xml);
      if (result.success) {
        onPushLog('Success', `Bank Statement (${data.bankName}) Pushed`, `${data.transactions.length} vouchers generated. Missing ledgers auto-created.`);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Success' });
      } else {
        onPushLog('Failed', 'Bank Statement Push Failed', result.message);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed', error: result.message });
      }
    } catch (e) {
      onPushLog('Failed', 'Network Error', e instanceof Error ? e.message : 'Unknown');
      if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed', error: 'Network Error' });
    } finally {
      setIsPushing(false);
    }
  };

  const inputClass = "w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-tally-500 outline-none";

  return (
    <div className="flex flex-col h-full gap-6 animate-fade-in relative">
      {showInvoiceAlert && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm rounded-xl animate-fade-in">
          <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-2xl border-2 border-orange-400 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">This looks like an Invoice!</h3>
            <p className="text-slate-500 dark:text-slate-400 mt-2 mb-6">
              You uploaded <span className="font-semibold text-slate-800 dark:text-slate-200">{file?.name}</span> in the Bank Statement section, but it appears to be a Tax Invoice.
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={handleRedirect} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg transition-transform hover:-translate-y-1 flex items-center justify-center gap-2">
                <ArrowRight className="w-4 h-4" /> Process as Invoice
              </button>
              <button onClick={() => setShowInvoiceAlert(false)} className="w-full py-3 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-semibold">
                No, keep here (Force parse)
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Landmark className="w-6 h-6 text-tally-600" /> Bank Statement Processing
          </h2>
          <p className="text-sm text-slate-500">Extract PDF statements to Payment/Receipt vouchers</p>
        </div>

        {step === 2 && (
          <div className="flex items-center gap-3">
            <button onClick={handleSaveDraft} className="flex items-center gap-2 px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors" title="Save progress locally">
              <Save className="w-4 h-4" /> Save Draft
            </button>
            <div className="h-4 w-px bg-slate-300 dark:bg-slate-600 mx-1"></div>
            <button onClick={() => setStep(1)} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-sm font-medium">
              Upload New
            </button>
            <button onClick={handlePushToTally} disabled={isPushing} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 shadow-lg disabled:opacity-70 disabled:cursor-not-allowed">
              {isPushing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              {isPushing ? 'Updating Tally...' : 'Push to Tally'}
            </button>
          </div>
        )}
      </div>

      {step === 1 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-12">
          <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-6">
            {isProcessing ? <Loader2 className="w-10 h-10 animate-spin" /> : <UploadCloud className="w-10 h-10" />}
          </div>

          {isProcessing ? (
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Analyzing Statement...</h3>
              <p className="text-slate-500 mt-2">Extracting dates, descriptions, and amounts.</p>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Upload Bank Statement</h3>
              <p className="text-slate-500 max-w-md mx-auto">Upload a PDF or Image of your bank statement. AI will convert rows into Payment/Receipt vouchers.</p>
              <button onClick={() => fileInputRef.current?.click()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-bold shadow-md hover:shadow-lg transition-all">Select PDF / Image</button>
              <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileUpload} />
            </div>
          )}

          {hasDraft && !isProcessing && (
            <div className="mt-6 flex items-center gap-3 animate-fade-in">
              <button onClick={handleRestoreDraft} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-semibold hover:bg-indigo-100 transition-colors">
                <History className="w-4 h-4" /> Restore Saved Draft
              </button>
              <button onClick={clearDraft} className="p-2 text-slate-400 hover:text-red-500 transition-colors" title="Discard Draft"><Trash2 className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50 dark:bg-slate-900/50">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Your Tally Bank Ledger Name</label>
              <input type="text" value={data.bankName} onChange={(e) => setData({...data, bankName: e.target.value})} className="w-full max-w-xs px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-semibold" placeholder="e.g. HDFC Bank" />
              <p className="text-[10px] text-slate-400 mt-1">If this ledger doesn't exist, it will be auto-created in 'Bank Accounts'.</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{data.transactions.length} Transactions</p>
              <p className="text-xs text-slate-500">Review & Map Ledgers below</p>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-700 sticky top-0">
                <tr>
                  <th className="px-4 py-3 w-32">Date</th>
                  <th className="px-4 py-3 min-w-[200px]">Description (Narration)</th>
                  <th className="px-4 py-3 w-28">Type</th>
                  <th className="px-4 py-3 w-28 text-right">Debit</th>
                  <th className="px-4 py-3 w-28 text-right">Credit</th>
                  <th className="px-4 py-3 w-48">Contra Ledger (Expense/Party)</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.transactions.map((txn) => (
                  <tr key={txn.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="p-2">
                      <input type="text" value={txn.date} onChange={(e) => handleTransactionChange(txn.id, 'date', e.target.value)} className={inputClass} />
                    </td>
                    <td className="p-2">
                      <input type="text" value={txn.description} onChange={(e) => handleTransactionChange(txn.id, 'description', e.target.value)} className={inputClass} />
                    </td>
                    <td className="p-2">
                      <select value={txn.type} onChange={(e) => handleTransactionChange(txn.id, 'type', e.target.value)} className={inputClass}>
                        <option value="Payment">Payment</option>
                        <option value="Receipt">Receipt</option>
                        <option value="Contra">Contra</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <input type="number" value={txn.debit} onChange={(e) => handleTransactionChange(txn.id, 'debit', parseFloat(e.target.value) || 0)} className={`${inputClass} text-right ${txn.debit > 0 ? 'font-bold text-red-600 dark:text-red-400' : 'text-slate-400'}`} />
                    </td>
                    <td className="p-2">
                      <input type="number" value={txn.credit} onChange={(e) => handleTransactionChange(txn.id, 'credit', parseFloat(e.target.value) || 0)} className={`${inputClass} text-right ${txn.credit > 0 ? 'font-bold text-green-600 dark:text-green-400' : 'text-slate-400'}`} />
                    </td>
                    <td className="p-2">
                      <input type="text" value={txn.contraLedger} onChange={(e) => handleTransactionChange(txn.id, 'contraLedger', e.target.value)} className={`${inputClass} ${(txn.contraLedger === 'Suspense A/c' || txn.contraLedger === 'UPI Suspense') ? 'border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20' : ''}`} placeholder="Tally Ledger Name" />
                    </td>
                    <td className="p-2 text-center">
                      <button onClick={() => removeTransaction(txn.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
            <button onClick={addTransaction} className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">+ Add Empty Row</button>
            <div className="flex gap-4 text-sm font-bold text-slate-700 dark:text-slate-300">
              <span>Total Withdrawals: <span className="text-red-600">{(data.totalWithdrawals || data.transactions.reduce((sum, t) => sum + (t.debit||0), 0)).toFixed(2)}</span></span>
              <span>Total Deposits: <span className="text-green-600">{(data.totalDeposits || data.transactions.reduce((sum, t) => sum + (t.credit||0), 0)).toFixed(2)}</span></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankStatementManager;
