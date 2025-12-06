import React, { useState, useEffect } from 'react';
import { X, Save, Server, Key, Box, CheckCircle2, AlertTriangle, Loader2, Wifi, WifiOff } from 'lucide-react';
import { AISettings } from '../types';

interface SettingsModalProps {
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<AISettings>({
    model: 'gemini-2.5-flash',
    apiKey: '',
    tallyCompany: ''
  });
  const [isSaved, setIsSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('autotally_ai_settings');
    if (saved) {
      setSettings(JSON.parse(saved));
    }
  }, []);

  const handleChange = (field: keyof AISettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    setTestStatus('idle');
  };

  const handleSave = () => {
    localStorage.setItem('autotally_ai_settings', JSON.stringify(settings));
    setIsSaved(true);
    setTimeout(() => {
        setIsSaved(false);
        onClose();
    }, 1000);
  };

  const handleTestConnection = async () => {
      if (!settings.apiKey) {
          setTestStatus('error');
          setTestMessage('Please enter an API Key first.');
          return;
      }
      
      setTestStatus('testing');
      setTestMessage('');
      
      try {
          // Test by making a simple request to the backend
          const response = await fetch('http://127.0.0.1:8000/health', {
              method: 'GET'
          });
          
          if (response.ok) {
              setTestStatus('success');
              setTestMessage('Backend connection successful');
          } else {
              setTestStatus('error');
              setTestMessage('Backend is not responding correctly');
          }
      } catch (error) {
          setTestStatus('error');
          let msg = "Connection Failed";
          if (error instanceof Error) msg = error.message;
          setTestMessage(msg);
      }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 shrink-0">
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-500" />
            AutoTally Settings
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
            
            {/* API Key */}
            <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    Model Name
                </label>
                <input 
                    type="text" 
                    value={settings.model}
                    onChange={(e) => handleChange('model', e.target.value)}
                    placeholder="gemini-2.5-flash"
                    className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
                <p className="text-xs text-slate-500">
                    Leave empty to use default model (gemini-2.5-flash).
                </p>
            </div>

            {/* Tally Company */}
            <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <Box className="w-4 h-4" />
                    Tally Company Name
                </label>
                <input 
                    type="text" 
                    value={settings.tallyCompany || ''}
                    onChange={(e) => handleChange('tallyCompany', e.target.value)}
                    placeholder="e.g., My Company Ltd"
                    className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
                <p className="text-xs text-slate-500">
                    Leave empty to use currently open company in Tally
                </p>
            </div>

            {/* Test Connection */}
             <div className="flex flex-col gap-2">
                <button 
                    onClick={handleTestConnection}
                    disabled={testStatus === 'testing'}
                    className={`
                        px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all w-fit
                        ${testStatus === 'idle' ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600' : ''}
                        ${testStatus === 'testing' ? 'bg-slate-100 text-slate-400 cursor-wait' : ''}
                        ${testStatus === 'success' ? 'bg-green-100 text-green-700 border border-green-300' : ''}
                        ${testStatus === 'error' ? 'bg-red-100 text-red-700 border border-red-300' : ''}
                    `}
                >
                    {testStatus === 'idle' && <Wifi className="w-4 h-4" />}
                    {testStatus === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
                    {testStatus === 'success' && <CheckCircle2 className="w-4 h-4" />}
                    {testStatus === 'error' && <WifiOff className="w-4 h-4" />}
                    
                    {testStatus === 'idle' && "Test Connection"}
                    {testStatus === 'testing' && "Testing..."}
                    {testStatus === 'success' && "Connected"}
                    {testStatus === 'error' && "Connection Failed"}
                </button>
                
                {testStatus === 'error' && (
                    <div className="text-xs text-red-500 font-medium bg-red-50 dark:bg-red-900/20 p-2 rounded border border-red-100 dark:border-red-900 break-words">
                        {testMessage}
                    </div>
                )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-xs text-blue-700 dark:text-blue-300">
                <p className="font-semibold mb-1">API Key Management</p>
                <p>API Keys are managed at the backend level (in your Python environment). Frontend settings are for configuration only.</p>
            </div>

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3 shrink-0">
            <button 
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white"
            >
                Cancel
            </button>
            <button 
                onClick={handleSave}
                className={`px-6 py-2 rounded-lg text-sm font-bold text-white transition-all flex items-center gap-2 ${isSaved ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
                <Save className="w-4 h-4" />
                {isSaved ? 'Saved!' : 'Save Settings'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
