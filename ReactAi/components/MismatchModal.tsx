import React from 'react';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';

interface MismatchModalProps {
  isOpen: boolean;
  uploadedAs: 'INVOICE' | 'BANK_STATEMENT' | 'EXCEL';
  detectedAs: 'INVOICE' | 'BANK_STATEMENT' | 'EXCEL';
  onRedirect: () => void;
  onDismiss: () => void;
}

const MismatchModal: React.FC<MismatchModalProps> = ({
  isOpen,
  uploadedAs,
  detectedAs,
  onRedirect,
  onDismiss
}) => {
  if (!isOpen) return null;

  const getDisplayName = (type: string) => {
    switch (type) {
      case 'INVOICE':
        return 'Invoice';
      case 'BANK_STATEMENT':
        return 'Bank Statement';
      case 'EXCEL':
        return 'Excel File';
      default:
        return type;
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md overflow-hidden flex flex-col animate-slide-up">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-amber-50 dark:bg-amber-900/20">
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            File Type Mismatch
          </h3>
          <button 
            onClick={onDismiss} 
            className="text-slate-400 hover:text-red-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            You uploaded this as a <strong className="text-slate-900 dark:text-white">{getDisplayName(uploadedAs)}</strong>, 
            but it looks like a <strong className="text-amber-600 dark:text-amber-400">{getDisplayName(detectedAs)}</strong>.
          </p>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 text-xs text-amber-700 dark:text-amber-300">
            <p className="font-semibold mb-1">What should I do?</p>
            <p>We detected the file content might be better suited for the {getDisplayName(detectedAs)} upload page. You can either continue here or switch to the correct upload page.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3">
          <button 
            onClick={onDismiss}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            Continue Here
          </button>
          <button 
            onClick={onRedirect}
            className="px-6 py-2 rounded-lg text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 transition-all flex items-center gap-2 shadow-lg hover:shadow-xl"
          >
            Go to {getDisplayName(detectedAs)}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MismatchModal;
