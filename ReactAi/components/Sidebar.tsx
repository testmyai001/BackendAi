
import React from 'react';
import { LayoutDashboard, UploadCloud, FileText, Activity, Settings, MessageSquareText, ScanEye } from 'lucide-react';
import { AppView } from '../types';

interface SidebarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView }) => {
  const navItems = [
    { id: AppView.DASHBOARD, label: 'Dashboard', icon: LayoutDashboard },
    { id: AppView.UPLOAD, label: 'Upload Invoice', icon: UploadCloud },
    { id: AppView.EDITOR, label: 'Editor & XML', icon: FileText },
    { id: AppView.CHAT, label: 'AI Chatbot', icon: MessageSquareText },
    { id: AppView.IMAGE_ANALYSIS, label: 'Image Analysis', icon: ScanEye },
    { id: AppView.LOGS, label: 'Tally Logs', icon: Activity },
  ];

  return (
    <div className="w-64 bg-slate-850 text-white flex flex-col h-full shadow-xl border-r border-slate-700 sticky top-0">
      <div className="p-6 flex items-center gap-3 border-b border-slate-700/50">
        <div className="w-8 h-8 bg-tally-600 rounded-lg flex items-center justify-center shadow-lg shadow-tally-600/20">
          <FileText className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">AutoTally AI</h1>
          <p className="text-xs text-slate-400">Automation Engine</p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onChangeView(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group ${
              currentView === item.id
                ? 'bg-tally-600 text-white shadow-md shadow-tally-600/10'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <item.icon className={`w-5 h-5 ${currentView === item.id ? 'text-white' : 'text-slate-500 group-hover:text-white'}`} />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700/50">
        <div className="flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white cursor-pointer transition-colors rounded-lg hover:bg-slate-800">
          <Settings className="w-5 h-5" />
          <span className="font-medium">Settings</span>
        </div>
        <div className="mt-4 px-4 text-xs text-slate-600">
          v1.1.0
        </div>
      </div>
    </div>
  );
};

export default Sidebar;