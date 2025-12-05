
import React, { useCallback, useState } from 'react';
import { Upload, Zap, History, FileUp } from 'lucide-react';
import { InvoiceData } from '../types';

interface InvoiceUploadProps {
  onFilesSelected: (files: File[]) => void;
  onRestoreDraft?: (data: InvoiceData) => void;
}

const InvoiceUpload: React.FC<InvoiceUploadProps> = ({ onFilesSelected, onRestoreDraft }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [useMock, setUseMock] = useState(false);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onFilesSelected(Array.from(e.dataTransfer.files));
    }
  }, [onFilesSelected]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        onFilesSelected(Array.from(e.target.files));
    }
  };

  const handleRestoreDraft = () => {
    try {
        const saved = localStorage.getItem('autotally_autosave');
        if (saved && onRestoreDraft) {
            const data = JSON.parse(saved);
            onRestoreDraft(data);
        }
    } catch (e) {
        console.error("Failed to restore draft", e);
    }
  };

  const hasSavedDraft = typeof window !== 'undefined' && !!localStorage.getItem('autotally_autosave');

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 h-full flex flex-col relative overflow-hidden transition-colors duration-200 animate-fade-in">
      
      <div className="p-8 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center relative z-10">
        <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
                    <FileUp className="w-6 h-6" />
                </div>
                Upload Invoices
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-1">Upload PDF or Image files to start the OCR extraction process.</p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-700 rounded-lg">
            <button 
                onClick={() => setUseMock(false)}
                className={`px-3 py-1.5 text-xs font-bold rounded transition-all flex items-center gap-1 ${!useMock ? 'bg-white dark:bg-slate-600 shadow text-indigo-700 dark:text-indigo-300' : 'text-slate-400 dark:text-slate-400'}`}
            >
                <Zap className="w-3 h-3" />
                AI OCR
            </button>
            <button 
                onClick={() => setUseMock(true)}
                className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${useMock ? 'bg-white dark:bg-slate-600 shadow text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-400'}`}
                title="Mock Mode (Not implemented for bulk upload yet)"
            >
                MOCK
            </button>
        </div>
      </div>

      <div className="p-8 flex-1 flex flex-col relative z-10">
        <div 
            className={`
            flex-1 flex flex-col items-center justify-center border-3 border-dashed rounded-2xl transition-all duration-300 p-10
            ${isDragOver 
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 scale-[0.99]' 
                : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'}
            `}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
        >
            <div className="text-center space-y-6 max-w-lg">
                <div className="w-24 h-24 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-3xl flex items-center justify-center mx-auto shadow-sm group-hover:scale-110 transition-transform">
                    <Upload className="w-10 h-10" />
                </div>
                
                <div className="space-y-2">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Drag & Drop Invoices Here</h3>
                    <p className="text-slate-500 dark:text-slate-400">
                        Supports PDF, JPG, PNG. You can upload multiple files at once.
                    </p>
                </div>

                <div className="flex flex-col items-center gap-4">
                    <label className="inline-flex items-center justify-center px-8 py-4 bg-slate-900 dark:bg-slate-700 text-white text-sm font-bold rounded-xl hover:bg-slate-800 dark:hover:bg-slate-600 cursor-pointer transition-all hover:shadow-xl hover:-translate-y-1">
                        BROWSE FILES
                        <input type="file" multiple className="hidden" accept=".pdf,.jpg,.png" onChange={handleFileInput} />
                    </label>
                    
                    {hasSavedDraft && onRestoreDraft && (
                        <button 
                            onClick={handleRestoreDraft}
                            className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium mt-4 py-2 px-4 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                        >
                            <History className="w-4 h-4" />
                            Restore previous unsaved draft
                        </button>
                    )}
                </div>
            </div>
        </div>
        
        <div className="mt-6 flex justify-center text-xs text-slate-400 dark:text-slate-500">
            <p>Securely processed in your browser via AutoTally AI. No data stored on server.</p>
        </div>
      </div>
    </div>
  );
};

export default InvoiceUpload;
