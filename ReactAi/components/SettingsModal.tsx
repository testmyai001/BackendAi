import React, { useState } from 'react';
import { X, Moon, Sun, Shield, Trash2, Monitor, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { removePin } from '../services/authService';

interface SettingsModalProps {
  onClose: () => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, darkMode, toggleDarkMode }) => {
  const [confirmReset, setConfirmReset] = useState(false);

  const handleResetPin = () => {
    removePin();
    window.location.reload(); // Reload to force re-auth setup
  };

  const handleClearData = () => {
    if (confirmReset) {
      localStorage.clear();
      window.location.reload();
    } else {
      setConfirmReset(true);
    }
  };


  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Monitor className="w-5 h-5 text-indigo-500" />
            Website Settings
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-8">
            
            {/* Appearance Section */}
            <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Appearance</h4>
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${darkMode ? 'bg-indigo-900/30 text-indigo-400' : 'bg-amber-100 text-amber-600'}`}>
                            {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                        </div>
                        <div>
                            <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm">Dark Mode</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{darkMode ? 'Active' : 'Inactive'}</p>
                        </div>
                    </div>
                    <button 
                        onClick={toggleDarkMode}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${darkMode ? 'bg-indigo-600' : 'bg-slate-200'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${darkMode ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            </div>

            {/* Security Section */}
            <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Security</h4>
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                            <Shield className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm">Security PIN</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Protect access to this device</p>
                        </div>
                    </div>
                    <button 
                        onClick={handleResetPin}
                        className="px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1"
                    >
                        <RefreshCw className="w-3 h-3" /> Reset
                    </button>
                </div>
            </div>

            {/* Data Section */}
            <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Data Management</h4>
                <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30">
                    <div className="flex items-start gap-3 mb-4">
                        <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
                        <div>
                            <p className="font-bold text-red-800 dark:text-red-400 text-sm">Clear Application Data</p>
                            <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                                This will remove all local logs, saved drafts, and reset your PIN. This action cannot be undone.
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={handleClearData}
                        className={`w-full py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                            confirmReset 
                            ? 'bg-red-600 text-white hover:bg-red-700 shadow-md' 
                            : 'bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20'
                        }`}
                    >
                        <Trash2 className="w-4 h-4" />
                        {confirmReset ? 'Click again to confirm' : 'Clear All Data'}
                    </button>
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
