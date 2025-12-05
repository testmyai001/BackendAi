import React, { useEffect, useState, useMemo } from 'react';
import { InvoiceData, LineItem } from '../types';
import { Plus, Trash2, Save, RefreshCw, FileText, ExternalLink, ArrowRight, Loader2, ChevronLeft, ChevronRight, FileDown, Check, AlertTriangle, ShieldAlert } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { fetchOpenCompanies } from '../services/tallyService';
import { calculateTotals } from '../services/backendService';

interface InvoiceEditorProps {
  data: InvoiceData;
  file?: File;
  onSave: (data: InvoiceData, switchTab?: boolean) => void;
  onPush: (data: InvoiceData) => void;
  isPushing: boolean;
  currentIndex?: number;
  totalCount?: number;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}

const InvoiceEditor: React.FC<InvoiceEditorProps> = ({ 
    data, 
    file, 
    onSave, 
    onPush, 
    isPushing,
    currentIndex = 0,
    totalCount = 0,
    onNext,
    onPrev,
    hasNext = false,
    hasPrev = false
}) => {
  const [formData, setFormData] = useState<InvoiceData>(data);
  const [totals, setTotals] = useState({ taxable: 0, cgst: 0, sgst: 0, grand: 0 });
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [calculatingTotals, setCalculatingTotals] = useState(false);
  
  // Company Fetching State
  const [companies, setCompanies] = useState<string[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  useEffect(() => {
    setFormData(data);
  }, [data]);

  useEffect(() => {
    if (file) {
        const url = URL.createObjectURL(file);
        setFileUrl(url);
        return () => URL.revokeObjectURL(url);
    }
  }, [file]);
  
  useEffect(() => {
      loadCompanies();
  }, []);

  const loadCompanies = async () => {
    setLoadingCompanies(true);
    const list = await fetchOpenCompanies();
    setCompanies(list);
    setLoadingCompanies(false);
  };

  // Fetch totals from backend whenever line items change
  // Fetch totals from backend whenever important fields change
useEffect(() => {
  const fetchTotals = async () => {
    if (formData.lineItems.length === 0) {
      setTotals({ taxable: 0, cgst: 0, sgst: 0, grand: 0 });
      return;
    }

    setCalculatingTotals(true);

    try {
      const result = await calculateTotals(
        formData.lineItems.map(item => ({
          amount: Number(item.amount) || 0,
          gstRate: Number(item.gstRate) || 0
        }))
      );

      setTotals({
        taxable: result.taxable,
        cgst: result.cgst,
        sgst: result.sgst,
        grand: result.total
      });

      // === Prevent infinite loop ===
      setFormData(prev => {
        const updated = prev.lineItems.map((item, idx) => {
          const newCgst = result.lineItemTotals[idx]?.cgst;
          const newSgst = result.lineItemTotals[idx]?.sgst;

          // If values are same → keep original object (prevents re-render)
          if (item.cgst === newCgst && item.sgst === newSgst) {
            return item;
          }

          return {
            ...item,
            cgst: newCgst,
            sgst: newSgst
          };
        });

        const isSame = updated.every((itm, i) => itm === prev.lineItems[i]);
        if (isSame) return prev;

        return { ...prev, lineItems: updated };
      });

    } catch (error) {
      console.error('Failed to calculate totals:', error);
    } finally {
      setCalculatingTotals(false);
    }
  };

  const debounceTimer = setTimeout(fetchTotals, 600);
  return () => clearTimeout(debounceTimer);

}, [
  JSON.stringify(
    formData.lineItems.map(i => ({
      amount: i.amount,
      gstRate: i.gstRate
    }))
  )
]);

  // Validation Logic
  const validationErrors = useMemo(() => {
    const errors: { field: string; message: string; id?: string }[] = [];
    
    // GSTIN Regex
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    
    if (formData.supplierGstin && !gstinRegex.test(formData.supplierGstin)) {
        errors.push({ field: 'supplierGstin', message: 'Invalid Supplier GSTIN Format' });
    }
    if (formData.buyerGstin && !gstinRegex.test(formData.buyerGstin)) {
        errors.push({ field: 'buyerGstin', message: 'Invalid Buyer GSTIN Format' });
    }

    // Date Validation
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    if (formData.invoiceDate) {
         if (!dateRegex.test(formData.invoiceDate)) {
             errors.push({ field: 'invoiceDate', message: 'Date must be DD-MM-YYYY' });
         } else {
             const [d, m, y] = formData.invoiceDate.split('-').map(Number);
             const dateObj = new Date(y, m - 1, d);
             if (dateObj.getFullYear() !== y || dateObj.getMonth() !== m - 1 || dateObj.getDate() !== d) {
                 errors.push({ field: 'invoiceDate', message: 'Invalid calendar date' });
             }
         }
    }

    return errors;
  }, [formData]);

  const handleChange = (field: keyof InvoiceData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleLineItemChange = (id: string, field: keyof LineItem, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      lineItems: prev.lineItems.map(item => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        
        // Auto-calculate amount if qty or rate changes
        if (field === 'quantity' || field === 'rate') {
          const rawAmount = Number(updated.quantity) * Number(updated.rate);
          updated.amount = Math.round((rawAmount + 1e-9) * 100) / 100;
        }
        return updated;
      })
    }));
  };

  const addLineItem = () => {
    setFormData(prev => ({
      ...prev,
      lineItems: [...prev.lineItems, {
        id: uuidv4(),
        description: '',
        hsn: '',
        quantity: 1,
        rate: 0,
        amount: 0,
        gstRate: 18,
        unit: 'Nos'
      }]
    }));
  };

  const removeLineItem = (id: string) => {
    setFormData(prev => ({
      ...prev,
      lineItems: prev.lineItems.filter(item => item.id !== id)
    }));
  };

  const handleSave = () => {
      onSave(formData, false);
  };

  const handleSaveDraft = () => {
      localStorage.setItem('autotally_autosave', JSON.stringify(formData));
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
  };
  
  const handleSaveAndNext = () => {
      onSave(formData, false);
      if (onNext) onNext();
  };

  const handlePush = () => {
      onPush(formData);
  };

  // Helper to check for errors on a specific field
  const hasError = (field: string, id?: string) => {
      return validationErrors.some(e => e.field === field && (id ? e.id === id : true));
  };

  // High visibility styles for inputs
  const getBaseInputClass = (isError: boolean) => `
    w-full px-3 py-2 border rounded-lg text-sm outline-none shadow-sm transition-colors
    ${isError 
        ? 'border-red-400 bg-red-50 dark:bg-red-900/20 text-slate-900 dark:text-white focus:border-red-500 focus:ring-1 focus:ring-red-500' 
        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-tally-500 placeholder-slate-400 dark:placeholder-slate-500'
    }
  `;

  const getTableInputClass = (isError: boolean) => `
    w-full px-2 py-1.5 border rounded outline-none text-sm shadow-sm transition-colors
    ${isError 
        ? 'border-red-400 bg-red-50 dark:bg-red-900/20 text-slate-900 dark:text-white focus:border-red-500' 
        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:border-tally-500 placeholder-slate-400 dark:placeholder-slate-500'
    }
  `;

  return (
    <div className="flex h-full bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden animate-fade-in transition-colors duration-200">
      
      {/* LEFT PANE: File Preview */}
      <div className="w-5/12 border-r border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/50 flex flex-col">
         {/* Preview Header */}
         <div className="p-3 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between text-sm bg-white dark:bg-slate-800">
             <div className="flex items-center gap-2">
                 <FileText className="w-4 h-4" />
                 Original File Preview
             </div>
             {fileUrl && (
                <a 
                    href={fileUrl} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-xs text-blue-600 dark:text-blue-400 font-medium transition-colors"
                    title="Open PDF in a new browser tab for full view"
                >
                    <ExternalLink className="w-3 h-3" /> 
                    Open in New Tab
                </a>
             )}
         </div>

         {/* Preview Content */}
         <div className="flex-1 overflow-hidden bg-slate-200 dark:bg-slate-950 flex items-center justify-center relative">
             {fileUrl ? (
                 file?.type === 'application/pdf' ? (
                    <object 
                        data={`${fileUrl}#toolbar=0&navpanes=0`} 
                        type="application/pdf" 
                        className="w-full h-full"
                    >
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2 p-4">
                            <p>Preview not available inline.</p>
                            <a 
                                href={fileUrl} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-blue-600 underline"
                            >
                                Click here to view PDF
                            </a>
                        </div>
                    </object>
                 ) : (
                     <div className="p-4 overflow-auto w-full h-full flex items-center justify-center">
                         <img src={fileUrl} alt="Invoice" className="max-w-full h-auto rounded shadow-sm border border-slate-300 dark:border-slate-700" />
                     </div>
                 )
             ) : (
                 <div className="text-slate-400 text-center text-sm">
                     <p>No preview available.</p>
                 </div>
             )}
         </div>
      </div>

      {/* RIGHT PANE: Editor Form */}
      <div className="w-7/12 flex flex-col h-full">
        {/* Toolbar */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 sticky top-0 z-10 shrink-0">
            {/* Navigation Controls */}
            <div className="flex items-center gap-2">
                <div className="flex bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-0.5">
                    <button 
                        onClick={() => { onSave(formData, false); if(onPrev) onPrev(); }}
                        disabled={!hasPrev}
                        className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Previous Invoice"
                    >
                        <ChevronLeft className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                    </button>
                    <span className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 border-l border-r border-slate-200 dark:border-slate-700 min-w-[100px] text-center">
                        Invoice {currentIndex + 1} of {totalCount}
                    </span>
                    <button 
                         onClick={() => { onSave(formData, false); if(onNext) onNext(); }}
                        disabled={!hasNext}
                        className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Next Invoice"
                    >
                        <ChevronRight className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button 
                    onClick={handleSaveDraft}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shadow-sm border ${draftSaved ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/30 dark:border-green-800 dark:text-green-400' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                    title="Save to browser storage (won't be lost on refresh)"
                >
                    {draftSaved ? <Check className="w-3.5 h-3.5" /> : <FileDown className="w-3.5 h-3.5" />}
                    {draftSaved ? 'Saved' : 'Save Draft'}
                </button>

                <button 
                    onClick={handlePush}
                    disabled={isPushing}
                    className={`flex items-center gap-2 px-3 py-1.5 text-white text-xs font-medium rounded-lg transition-colors shadow-sm ${
                        isPushing ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                >
                    {isPushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                    {isPushing ? 'Pushing...' : 'Push to Tally'}
                </button>

                {hasNext ? (
                    <button 
                        onClick={handleSaveAndNext}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                    >
                        <Save className="w-3.5 h-3.5" />
                        Save & Next
                    </button>
                ) : (
                    <button 
                        onClick={handleSave}
                        className="flex items-center gap-2 px-3 py-1.5 bg-tally-600 hover:bg-tally-700 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                    >
                        <Save className="w-3.5 h-3.5" />
                        Update Invoice
                    </button>
                )}
            </div>
        </div>
        
        {/* VALIDATION WARNING BANNER */}
        {validationErrors.length > 0 && (
            <div className="mx-6 mt-4 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg flex items-start gap-3 animate-fade-in shadow-sm">
                <ShieldAlert className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                    <h4 className="text-sm font-bold text-orange-800 dark:text-orange-300 flex items-center justify-between">
                        Validation Issues
                        <span className="text-[10px] bg-orange-100 dark:bg-orange-800 px-2 py-0.5 rounded-full">{validationErrors.length} Issues</span>
                    </h4>
                    <ul className="list-disc list-inside text-xs text-orange-700 dark:text-orange-400 mt-1 space-y-0.5">
                        {validationErrors.slice(0, 3).map((err, i) => (
                            <li key={i}>{err.message}</li>
                        ))}
                        {validationErrors.length > 3 && <li>And {validationErrors.length - 3} more issues...</li>}
                    </ul>
                </div>
            </div>
        )}

        <div className="flex-1 overflow-auto p-6 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent">
            {/* Header Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <div className="space-y-4">
                <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase mb-1">Voucher Type</label>
                <select 
                    value={formData.voucherType}
                    onChange={(e) => handleChange('voucherType', e.target.value as 'Sales' | 'Purchase')}
                    className={getBaseInputClass(false)}
                >
                    <option value="Sales">Sales</option>
                    <option value="Purchase">Purchase</option>
                </select>
                </div>
                
                <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase mb-1">Target Company</label>
                <div className="flex gap-1">
                    <select 
                        value={formData.targetCompany || ''}
                        onChange={(e) => handleChange('targetCompany', e.target.value)}
                        className={`${getBaseInputClass(false)} flex-1 cursor-pointer`}
                    >
                        <option value="">Active Company (Default)</option>
                        {companies.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                    <button 
                        onClick={loadCompanies}
                        disabled={loadingCompanies}
                        className="p-2 text-slate-500 dark:text-slate-400 hover:text-tally-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded border border-slate-300 dark:border-slate-600 transition-colors"
                        title="Refresh Company List"
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingCompanies ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                </div>

                <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase mb-1">Invoice Number</label>
                <input 
                    type="text" 
                    value={formData.invoiceNumber}
                    onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                    className={getBaseInputClass(false)}
                />
                </div>
                <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase mb-1">
                    Invoice Date
                    {hasError('invoiceDate') && <span className="text-red-500 ml-1 text-[10px]">(Invalid)</span>}
                </label>
                <input 
                    type="text"
                    placeholder="DD-MM-YYYY" 
                    value={formData.invoiceDate}
                    onChange={(e) => handleChange('invoiceDate', e.target.value)}
                    className={getBaseInputClass(hasError('invoiceDate'))}
                />
                </div>
            </div>

            <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2">Supplier Details</h4>
                <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Name</label>
                <input 
                    type="text" 
                    value={formData.supplierName}
                    onChange={(e) => handleChange('supplierName', e.target.value)}
                    className={getBaseInputClass(false)}
                />
                </div>
                <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">GSTIN</label>
                <input 
                    type="text" 
                    value={formData.supplierGstin}
                    onChange={(e) => handleChange('supplierGstin', e.target.value)}
                    className={getBaseInputClass(hasError('supplierGstin'))}
                />
                </div>
            </div>

            <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2">Buyer Details</h4>
                <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Name</label>
                <input 
                    type="text" 
                    value={formData.buyerName}
                    onChange={(e) => handleChange('buyerName', e.target.value)}
                    className={getBaseInputClass(false)}
                />
                </div>
                <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">GSTIN</label>
                <input 
                    type="text" 
                    value={formData.buyerGstin}
                    onChange={(e) => handleChange('buyerGstin', e.target.value)}
                    className={getBaseInputClass(hasError('buyerGstin'))}
                />
                </div>
            </div>
            </div>

            {/* Line Items */}
            <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
                <h4 className="font-bold text-slate-900 dark:text-white">Line Items</h4>
                <button 
                    onClick={addLineItem}
                    className="text-tally-600 dark:text-tally-400 hover:text-tally-700 text-sm font-medium flex items-center gap-1"
                >
                    <Plus className="w-4 h-4" /> Add Item
                </button>
            </div>
            
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700 sticky top-0 z-0">
                    <tr>
                    <th className="px-4 py-3 min-w-[150px] bg-slate-50 dark:bg-slate-800">Description</th>
                    <th className="px-4 py-3 w-20 bg-slate-50 dark:bg-slate-800">Qty</th>
                    <th className="px-4 py-3 w-20 bg-slate-50 dark:bg-slate-800">Unit</th>
                    <th className="px-4 py-3 min-w-[80px] bg-slate-50 dark:bg-slate-800">Rate</th>
                    <th className="px-4 py-3 min-w-[100px] bg-slate-50 dark:bg-slate-800">Taxable</th>
                    <th className="px-4 py-3 w-20 bg-slate-50 dark:bg-slate-800">GST %</th>
                    <th className="px-4 py-3 w-10 bg-slate-50 dark:bg-slate-800"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {formData.lineItems.map((item) => (
                    <tr key={item.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="p-2">
                            <input 
                                type="text" 
                                value={item.description}
                                onChange={(e) => handleLineItemChange(item.id, 'description', e.target.value)}
                                className={getTableInputClass(false)}
                                placeholder="Desc"
                            />
                        </td>
                        <td className="p-2">
                            <input 
                                type="number" 
                                value={item.quantity}
                                onChange={(e) => handleLineItemChange(item.id, 'quantity', Number(e.target.value))}
                                className={getTableInputClass(false)}
                            />
                        </td>
                        <td className="p-2">
                            <input 
                                type="text" 
                                value={item.unit || 'Nos'}
                                onChange={(e) => handleLineItemChange(item.id, 'unit', e.target.value)}
                                className={getTableInputClass(false)}
                            />
                        </td>
                        <td className="p-2">
                            <input 
                                type="number" 
                                value={item.rate}
                                onChange={(e) => handleLineItemChange(item.id, 'rate', Number(e.target.value))}
                                className={getTableInputClass(false)}
                            />
                        </td>
                        <td className="p-2 font-mono font-medium">
                            <input 
                                type="number" 
                                value={item.amount}
                                onChange={(e) => handleLineItemChange(item.id, 'amount', Number(e.target.value))}
                                className={getTableInputClass(false)}
                            />
                        </td>
                        <td className="p-2">
                            <select
                                value={item.gstRate}
                                onChange={(e) => handleLineItemChange(item.id, 'gstRate', Number(e.target.value))}
                                className={getTableInputClass(false)}
                            >
                                <option value={0}>0%</option>
                                <option value={5}>5%</option>
                                <option value={12}>12%</option>
                                <option value={18}>18%</option>
                                <option value={28}>28%</option>
                            </select>
                        </td>
                        <td className="p-2 text-center">
                            <button 
                                onClick={() => removeLineItem(item.id)}
                                className="text-slate-400 hover:text-red-500 transition-all"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </td>
                    </tr>
                    ))}
                </tbody>
                </table>
            </div>
            </div>

            {/* Totals Summary */}
            <div className="flex justify-end">
            <div className="w-64 space-y-3 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                    <span>Taxable Amount</span>
                    <span>₹{totals.taxable.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                    <span>CGST</span>
                    <span>₹{totals.cgst.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                    <span>SGST</span>
                    <span>₹{totals.sgst.toLocaleString('en-IN')}</span>
                </div>
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between font-bold text-lg text-slate-900 dark:text-white">
                    <span>Grand Total</span>
                    <span>₹{totals.grand.toLocaleString('en-IN')}</span>
                </div>
                {calculatingTotals && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 justify-center pt-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> Calculating...
                    </div>
                )}
            </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceEditor;
