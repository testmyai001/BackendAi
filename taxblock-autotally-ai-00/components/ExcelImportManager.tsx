
import React, { useState, useRef, useEffect } from 'react';
import { FileSpreadsheet, Upload, ArrowRight, Loader2, CheckCircle2, AlertTriangle, Merge, Database, ListPlus, ShieldAlert, RefreshCw } from 'lucide-react';
import { read, utils } from 'xlsx';
import { ExcelVoucher, ProcessedFile } from '../types';
import { generateBulkExcelXml, pushToTally, fetchExistingLedgers, analyzeLedgerRequirements } from '../services/tallyService';
import { v4 as uuidv4 } from 'uuid';

interface ExcelImportManagerProps {
  onPushLog: (status: 'Success' | 'Failed', message: string, response?: string) => void;
  onRegisterFile?: (file: File) => string; // NEW
  onUpdateFile?: (id: string, updates: Partial<ProcessedFile>) => void; // NEW
}

const IGNORED_COLUMNS = [
  'GSTR3B Filling status',
  'GSTR-1/5 Filling status',
  'GSTR-1/5 Filling Date',
  'GSTR-1/5 Filling Period',
  'Tax Period in which Amended',
  'Amendment Type',
  'E-Invoice Applicable',
  'Reverse Charge'
];

// Precision Helper to avoid Tally Mismatch errors
const round = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

const ExcelImportManager: React.FC<ExcelImportManagerProps> = ({ onPushLog, onRegisterFile, onUpdateFile }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);

  const [rawData, setRawData] = useState<any[]>([]);
  const [mappedData, setMappedData] = useState<ExcelVoucher[]>([]);
  const [progress, setProgress] = useState({ processed: 0, total: 0, batch: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Ledger Analysis State
  const [missingLedgers, setMissingLedgers] = useState<string[]>([]);
  const [isCheckingLedgers, setIsCheckingLedgers] = useState(false);
  const [connectionError, setConnectionError] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Column Mapping State
  const [allColumns, setAllColumns] = useState<string[]>([]); // Full header for data mapping
  const [mapping, setMapping] = useState({
    date: '',
    invoiceNo: '',
    partyName: '',
    gstin: '',
    amount: '',
    taxRate: '',
    voucherType: ''
  });

  const BATCH_SIZE = 50;

  // Run ledger analysis when entering Step 3
  useEffect(() => {
      if (step === 3 && mappedData.length > 0) {
          checkLedgers();
      }
  }, [step, mappedData]);

  const checkLedgers = async () => {
      setIsCheckingLedgers(true);
      setConnectionError(false);
      try {
          const existing = await fetchExistingLedgers();
          const missing = analyzeLedgerRequirements(mappedData, existing);
          setMissingLedgers(missing);
      } catch (e) {
          console.warn("Failed to check ledgers");
          setConnectionError(true);
      } finally {
          setIsCheckingLedgers(false);
      }
  };
  
  const handleForceAnalysis = () => {
      const allLedgers = analyzeLedgerRequirements(mappedData, new Set());
      setMissingLedgers(allLedgers);
      setConnectionError(false); 
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      setFile(f);
      
      let currentFileId = null;
      if (onRegisterFile) {
          currentFileId = onRegisterFile(f);
          setFileId(currentFileId);
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataBuffer = evt.target?.result;
        if (!dataBuffer) return;

        try {
            const wb = read(dataBuffer, { type: 'array' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = utils.sheet_to_json(ws, { header: 1 }) as any[][]; 
            
            if (data.length > 0) {
                // --- SMART HEADER DETECTION ---
                let headerRowIndex = 0;
                let maxScore = 0;
                const keywords = ['date', 'invoice', 'no', 'gstin', 'party', 'name', 'tax', 'amount', 'rate', 'value', 'type', 'place', 'supply', 'customer', 'vch'];

                for(let i = 0; i < Math.min(data.length, 20); i++) {
                    const row = data[i];
                    if (!Array.isArray(row)) continue;
                    
                    let score = 0;
                    row.forEach(cell => {
                        if (typeof cell === 'string') {
                            const val = cell.toLowerCase();
                            if (keywords.some(k => val.includes(k))) score++;
                        }
                    });

                    if (score > maxScore) {
                        maxScore = score;
                        headerRowIndex = i;
                    }
                }
                
                const header = (data[headerRowIndex] || []).map(String);
                
                setAllColumns(header);
                setRawData(data.slice(headerRowIndex + 1)); 
                
                // Auto-guess mapping based on the detected header
                const guess = { ...mapping };
                header.forEach(col => {
                    // Don't auto-map ignored columns
                    if (IGNORED_COLUMNS.some(ig => col.toLowerCase().includes(ig.toLowerCase()))) return;

                    const c = col.toLowerCase();
                    if (c.includes('date')) guess.date = col;
                    if (c.includes('inv') || c.includes('no')) guess.invoiceNo = col;
                    if (c.includes('party') || c.includes('name') || c.includes('customer')) guess.partyName = col;
                    if (c.includes('gst') && !c.includes('rate')) guess.gstin = col;
                    if (c.includes('amount') || c.includes('value') || c.includes('total') || c.includes('taxable')) guess.amount = col;
                    if (c.includes('rate') || c.includes('%')) guess.taxRate = col;
                    if (c.includes('type')) guess.voucherType = col;
                });
                setMapping(guess);
                setStep(2);
                
                if (onUpdateFile && currentFileId) {
                     onUpdateFile(currentFileId, { status: 'Processing' });
                }

            }
        } catch (err) {
            console.error("Excel Read Error:", err);
            onPushLog('Failed', 'Excel Parse Error', 'Could not read file. Ensure it is a valid .xlsx or .csv');
            if (onUpdateFile && currentFileId) {
                 onUpdateFile(currentFileId, { status: 'Failed', error: 'Excel Read Error' });
            }
        }
      };
      reader.readAsArrayBuffer(f);
    }
  };

  const processMapping = () => {
    // 1. Map raw rows to flat objects
    const flatRows = rawData.map((row: any) => {
        const idx = (colName: string) => allColumns.indexOf(colName);
        const val = (colName: string) => row[idx(colName)];

        // --- DATE PARSING LOGIC ---
        let dateVal: any = val(mapping.date);
        
        // Handle Excel Serial Date (e.g. 45765)
        // Excel Epoch: Dec 30, 1899. JS Epoch: Jan 1, 1970. Diff: 25569 days.
        if (typeof dateVal === 'number' || (!isNaN(Number(dateVal)) && Number(dateVal) > 20000)) {
             const serial = Number(dateVal);
             // 86400 seconds in a day
             const utc_days  = Math.floor(serial - 25569);
             const utc_value = utc_days * 86400; 
             const date_info = new Date(utc_value * 1000);
             
             const y = date_info.getFullYear();
             const m = String(date_info.getMonth() + 1).padStart(2, '0');
             const d = String(date_info.getDate()).padStart(2, '0');
             dateVal = `${y}-${m}-${d}`; // YYYY-MM-DD
        } else if (typeof dateVal === 'string') {
            dateVal = dateVal.trim();
        } else {
            dateVal = new Date().toISOString().slice(0, 10);
        }

        const vTypeVal = String(val(mapping.voucherType) || '');
        const vType = vTypeVal.toLowerCase().includes('pur') ? 'Purchase' : 'Sales';
        
        let rawAmount = val(mapping.amount);
        if (typeof rawAmount === 'string') {
            rawAmount = parseFloat(rawAmount.replace(/,/g, ''));
        }
        rawAmount = Number(rawAmount) || 0;

        let rawRate = val(mapping.taxRate);
        if (typeof rawRate === 'string') {
            rawRate = parseFloat(rawRate.replace(/%/g, ''));
        }
        rawRate = Number(rawRate) || 0;

        return {
            date: String(dateVal),
            invoiceNo: String(val(mapping.invoiceNo) || '').trim(),
            partyName: String(val(mapping.partyName) || 'Cash').trim(),
            gstin: String(val(mapping.gstin) || ''),
            amount: rawAmount,
            taxRate: rawRate,
            voucherType: vType as 'Sales' | 'Purchase'
        };
    }).filter(t => t.amount > 0 && t.invoiceNo !== ''); 

    // 2. Group By (InvoiceNo + Date + PartyName)
    const groupedMap = new Map<string, ExcelVoucher>();

    flatRows.forEach(row => {
        // CLEAN KEY GENERATION: Trim and lowercase to ensure perfect matching
        const cleanInv = row.invoiceNo.trim().toLowerCase();
        const cleanDate = row.date.trim();
        const cleanParty = row.partyName.trim().toLowerCase();
        const key = `${cleanInv}_${cleanParty}_${cleanDate}`;
        
        if (!groupedMap.has(key)) {
            groupedMap.set(key, {
                id: uuidv4(),
                date: row.date,
                invoiceNo: row.invoiceNo,
                partyName: row.partyName,
                gstin: row.gstin,
                voucherType: row.voucherType,
                items: [],
                totalAmount: 0
            });
        }

        const voucher = groupedMap.get(key)!;
        
        // Push the item with its specific tax rate
        voucher.items.push({
            amount: row.amount,
            taxRate: row.taxRate
        });
        
        // STRICT CALCULATION LOGIC
        // Calculate Taxable + Tax for this line item and add to voucher Total
        const taxable = round(row.amount);
        const taxAmount = round(taxable * (row.taxRate / 100));
        const lineTotal = round(taxable + taxAmount);
        
        voucher.totalAmount = round(voucher.totalAmount + lineTotal);
    });

    const vouchers = Array.from(groupedMap.values());

    setMappedData(vouchers);
    setProgress({ processed: 0, total: vouchers.length, batch: 0 });
    setStep(3);
    
    if (onUpdateFile && fileId) {
         onUpdateFile(fileId, { 
             status: 'Ready', 
             correctEntries: vouchers.length, // Treat Merged Vouchers as Correct Entries
             timeTaken: 'Ready to Push'
         });
    }
  };

  const startBulkPush = async () => {
      setIsProcessing(true);
      if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Processing' });

      try {
        const total = mappedData.length;
        const totalBatches = Math.ceil(total / BATCH_SIZE);
        
        let existingLedgers = new Set<string>();
        try {
            existingLedgers = await fetchExistingLedgers();
        } catch {
        }

        for (let i = 0; i < totalBatches; i++) {
            const start = i * BATCH_SIZE;
            const end = start + BATCH_SIZE;
            const batch = mappedData.slice(start, end);
            
            const xml = generateBulkExcelXml(batch, existingLedgers);
            
            await pushToTally(xml);
            
            setProgress({ 
                processed: Math.min(end, total), 
                total, 
                batch: i + 1 
            });

            await new Promise(r => setTimeout(r, 200));
        }
        
        onPushLog('Success', 'Bulk Import Complete', `Successfully pushed ${total} merged vouchers.`);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Success' });

      } catch (e) {
        onPushLog('Failed', 'Bulk Import Error', e instanceof Error ? e.message : 'Unknown Error');
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed', error: e instanceof Error ? e.message : 'Unknown' });
      } finally {
          setIsProcessing(false);
      }
  };

  // Filter columns for UI dropdowns
  const visibleColumns = allColumns.filter(col => 
      !IGNORED_COLUMNS.some(ignored => col.toLowerCase().includes(ignored.toLowerCase()))
  );

  // ... Render Logic Remains mostly same, just hooking up step renders ...
  if (step === 1) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-12 m-6 animate-fade-in">
            <div className="w-20 h-20 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mb-6">
               <FileSpreadsheet className="w-10 h-10" />
            </div>
            
            <div className="text-center space-y-4">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Bulk Excel Import</h3>
                <p className="text-slate-500 max-w-md mx-auto">
                    Upload Excel or CSV File
                </p>
                <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-bold shadow-md hover:shadow-lg transition-all"
                >
                Select Excel File
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFileUpload} />
            </div>
        </div>
      );
  }

  // Step 2 & 3 UI Logic is preserved from previous versions, just wrapping the return
  if (step === 2) {
      return (
          <div className="flex-1 p-6 flex flex-col gap-6 animate-fade-in overflow-hidden">
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  {/* ... Mapping UI ... */}
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-lg flex items-center gap-2 text-slate-900 dark:text-white">
                          <Database className="w-5 h-5 text-indigo-500" />
                          Map Columns
                      </h3>
                      <span className="text-xs px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded-lg">
                          Detected {allColumns.length} columns (Filtered)
                      </span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {Object.keys(mapping).map(key => (
                          <div key={key}>
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{key}</label>
                              <select 
                                value={mapping[key as keyof typeof mapping]}
                                onChange={(e) => setMapping({...mapping, [key]: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                              >
                                  <option value="">Select Column</option>
                                  {visibleColumns.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                          </div>
                      ))}
                  </div>
                  
                  <div className="mt-8 flex justify-end gap-3">
                       <button onClick={() => setStep(1)} className="px-4 py-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">Cancel</button>
                       <button 
                        onClick={processMapping}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 shadow-md"
                       >
                           Next <ArrowRight className="w-4 h-4" />
                       </button>
                  </div>
              </div>

              {/* Preview */}
              <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-auto">
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 font-bold text-sm text-slate-700 dark:text-slate-300">
                      Raw Data Preview (First 5 Rows - Filtered Columns)
                  </div>
                  <table className="w-full text-sm text-left whitespace-nowrap">
                      <thead className="bg-slate-50 dark:bg-slate-700 text-slate-500">
                          <tr>
                              {visibleColumns.map((c, i) => <th key={i} className="px-4 py-2 border-b border-slate-200 dark:border-slate-700">{c}</th>)}
                          </tr>
                      </thead>
                      <tbody>
                          {rawData.slice(0, 5).map((row, i) => (
                              <tr key={i} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                  {visibleColumns.map((colName, j) => {
                                      // Find index in original allColumns
                                      const idx = allColumns.indexOf(colName);
                                      return (
                                          <td key={j} className="px-4 py-2 text-slate-700 dark:text-slate-300">{row[idx]}</td>
                                      );
                                  })}
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      );
  }

  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
      <div className="flex-1 flex flex-col p-6 animate-fade-in h-full overflow-hidden">
        <div className="flex flex-col gap-6 h-full overflow-y-auto">
            
            <div className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col items-center justify-center p-10 text-center relative overflow-hidden shrink-0">
                {!isProcessing && progress.processed === 0 && (
                    <>
                        <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-6">
                            <Merge className="w-10 h-10 ml-1" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Ready to Import</h2>
                        <p className="text-slate-500 dark:text-slate-400 mb-8">
                            Found <strong className="text-slate-900 dark:text-white">{rawData.length}</strong> raw rows.<br/>
                            Merged into <strong className="text-indigo-600 dark:text-indigo-400 text-xl">{mappedData.length}</strong> unique vouchers.
                        </p>
                        <button 
                            onClick={startBulkPush}
                            className="w-full max-w-sm bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-bold text-lg shadow-lg hover:shadow-xl transition-all"
                            disabled={connectionError}
                        >
                            Start Bulk Import
                        </button>
                        {connectionError && (
                            <p className="text-red-500 text-xs mt-3">Fix connection to start import</p>
                        )}
                    </>
                )}

                {isProcessing && (
                    <>
                        <div className="mb-6 relative w-24 h-24 mx-auto">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-200 dark:text-slate-700" />
                                <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-indigo-600 transition-all duration-300" strokeDasharray="251.2" strokeDashoffset={251.2 - (251.2 * pct) / 100} />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-xl font-bold text-indigo-600">
                                {pct}%
                            </div>
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Importing to Tally...</h2>
                        <p className="text-slate-500 font-mono text-sm">
                            Processed {progress.processed} / {progress.total}
                        </p>
                    </>
                )}

                {!isProcessing && progress.processed > 0 && (
                    <>
                        <div className="w-20 h-20 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle2 className="w-10 h-10" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Import Complete!</h2>
                        <p className="text-slate-500 dark:text-slate-400 mb-8">
                            Successfully imported {progress.total} merged vouchers.
                        </p>
                        <button 
                            onClick={() => { setStep(1); setFile(null); setMappedData([]); setRawData([]); setMissingLedgers([]); setConnectionError(false); }}
                            className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-white px-8 py-3 rounded-lg font-bold"
                        >
                            Upload Another File
                        </button>
                    </>
                )}
            </div>

            <div className="flex-1 w-full flex flex-col bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden min-h-[300px]">
                <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h3 className="font-bold text-sm text-slate-800 dark:text-white flex items-center gap-2">
                        <ListPlus className="w-4 h-4 text-orange-500" />
                        Ledgers to Create
                    </h3>
                    <div className="flex items-center gap-2">
                         {isCheckingLedgers && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
                         {connectionError && (
                             <button 
                                onClick={checkLedgers} 
                                className="flex items-center gap-1 text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200 transition-colors"
                             >
                                 <RefreshCw className="w-3 h-3" /> Retry Connection
                             </button>
                         )}
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-slate-50/30 dark:bg-slate-900/10">
                    {connectionError ? (
                        <div className="text-center text-red-400 text-xs py-10 flex flex-col items-center">
                            <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
                            <p>Could not fetch existing ledgers from Tally.</p>
                            <p className="mt-1 opacity-75">Check if Ngrok and Proxy are running.</p>
                        </div>
                    ) : (
                        <>
                            {missingLedgers.length === 0 && !isCheckingLedgers && (
                                <div className="text-center text-slate-400 text-xs py-10">
                                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    <p>All ledgers seem to exist!</p>
                                </div>
                            )}
                            
                            {missingLedgers.map((ledger, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-xs py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0 text-slate-600 dark:text-slate-300">
                                    <div className="w-1.5 h-1.5 bg-orange-400 rounded-full mt-1 shrink-0"></div>
                                    {ledger}
                                </div>
                            ))}
                        </>
                    )}
                </div>

                <div className={`p-3 text-[10px] border-t flex items-start gap-2 ${connectionError ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border-red-100 dark:border-red-800' : 'bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300 border-orange-100 dark:border-orange-800'}`}>
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="font-bold mb-1">
                            {connectionError ? "Connection Failed" : "Auto-Creation Mode"}
                        </p>
                        {connectionError ? (
                            <div className="flex flex-col gap-1">
                                <p>We cannot verify which ledgers exist. You can force 'Create All', but this may cause duplicates if connection is actually active.</p>
                                <div className="flex gap-2 mt-2">
                                     <button onClick={handleForceAnalysis} className="text-xs bg-red-200 dark:bg-red-800 px-2 py-1 rounded hover:bg-red-300">
                                         Force Create All
                                     </button>
                                </div>
                            </div>
                        ) : (
                             <p>Missing ledgers will be created automatically.</p>
                        )}
                    </div>
                </div>
            </div>

        </div>
      </div>
  );
};

export default ExcelImportManager;
