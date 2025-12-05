
import React from 'react';
import { AlertOctagon, X, FileQuestion } from 'lucide-react';

interface InvalidFileModalProps {
  fileName: string;
  reason: string;
  onClose: () => void;
}

const InvalidFileModal: React.FC<InvalidFileModalProps> = ({ fileName, reason, onClose }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-2xl border-2 border-red-400 max-w-md w-full text-center relative">
        <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-red-500 transition-colors"
        >
            <X className="w-5 h-5" />
        </button>

        <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertOctagon className="w-8 h-8" />
        </div>
        
        <h3 className="text-xl font-bold text-slate-900 dark:text-white">Invalid File Uploaded</h3>
        
        <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg my-4 flex items-center justify-center gap-2">
            <FileQuestion className="w-4 h-4 text-slate-500" />
            <span className="font-mono text-sm text-slate-700 dark:text-slate-300 truncate max-w-[200px]">{fileName}</span>
        </div>

        <p className="text-slate-600 dark:text-slate-300 text-sm mb-6 leading-relaxed">
            {reason}
        </p>

        <div className="flex flex-col gap-2">
             <div className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                Please only upload <strong>Invoices</strong> (PDF/Image) or <strong>Bank Statements</strong>. 
                Other Document are not supported.
             </div>
             
             <button 
                onClick={onClose}
                className="mt-4 w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold shadow-md transition-colors"
             >
                Close
             </button>
        </div>
      </div>
    </div>
  );
};

export default InvalidFileModal;
