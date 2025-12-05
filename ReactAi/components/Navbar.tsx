
import React, { useState, useRef, useEffect } from 'react';
import { 
  LayoutDashboard, 
  UploadCloud, 
  FileText, 
  Activity, 
  MessageSquareText, 
  ScanEye, 
  Landmark, 
  Sun, 
  Moon, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Search,
  ChevronDown,
  Calculator
} from 'lucide-react';
import { AppView } from '../types';
import AccountingCalculator from './AccountingCalculator';

interface NavbarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  tallyStatus: { online: boolean; msg: string; mode: 'full' | 'blind' | 'none' };
  onCheckStatus: () => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
}

const Navbar: React.FC<NavbarProps> = ({ 
  currentView, 
  onChangeView,
  darkMode,
  toggleDarkMode,
  tallyStatus,
  onCheckStatus,
  searchTerm,
  onSearchChange
}) => {
  const [isUploadDropdownOpen, setIsUploadDropdownOpen] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsUploadDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownRef]);

  const navItems = [
    { id: AppView.DASHBOARD, label: 'Dashboard', icon: LayoutDashboard },
    { 
      id: 'UPLOADS', // Virtual ID for the dropdown parent
      label: 'Uploads', 
      icon: UploadCloud, 
      isDropdown: true,
      children: [
        { id: AppView.UPLOAD, label: 'Invoice Upload', icon: FileText },
        { id: AppView.BANK_STATEMENT, label: 'Bank Statement', icon: Landmark }
      ]
    },
    { id: AppView.EDITOR, label: 'Editor', icon: FileText },
    { id: AppView.CHAT, label: 'AI Chat', icon: MessageSquareText },
    { id: AppView.IMAGE_ANALYSIS, label: 'Analysis', icon: ScanEye },
    { id: AppView.LOGS, label: 'Logs', icon: Activity },
  ];

  const isCurrentViewInUploads = currentView === AppView.UPLOAD || currentView === AppView.BANK_STATEMENT;

  return (
    <div className="bg-slate-900 text-white shadow-lg shrink-0 z-50 flex flex-col">
      {/* Top Row: Logo, Search, Actions */}
      <div className="px-4 h-16 flex items-center justify-between border-b border-slate-800 gap-4">
        {/* Logo */}
        <div className="flex items-center gap-3 min-w-fit">
            <div className="w-8 h-8 bg-tally-600 rounded-lg flex items-center justify-center shadow-lg shadow-tally-600/20">
                <FileText className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight hidden md:block">AutoTally AI</h1>
        </div>

        {/* Global Search Bar */}
        <div className="flex-1 max-w-2xl px-4">
            <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400 group-focus-within:text-blue-400 transition-colors" />
                </div>
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-slate-700 rounded-lg leading-5 bg-slate-950 text-slate-300 placeholder-slate-500 focus:outline-none focus:bg-slate-900 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all"
                    placeholder="Search invoices, ledgers, or transactions..."
                />
            </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3 min-w-fit">
             {/* Tally Status */}
              <div className={`
                  hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-800/50 text-xs font-medium transition-colors
                  ${tallyStatus.online 
                      ? 'text-emerald-400 border-emerald-500/30' 
                      : 'text-red-400 border-red-500/30'}
              `}>
                  {tallyStatus.online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                  <span>{tallyStatus.online ? 'Connected' : 'Disconnected'}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${tallyStatus.online ? 'bg-emerald-500' : 'bg-red-500'} animate-pulse`}></span>
              </div>

             <div className="flex items-center gap-1">
                 <button 
                  onClick={onCheckStatus} 
                  title="Re-check Connection"
                  className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                 >
                  <RefreshCw className="w-4 h-4" />
                 </button>

                 <button
                    onClick={toggleDarkMode}
                    className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                 >
                    {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                 </button>
             </div>
        </div>
      </div>
      
      {/* Bottom Row: Navigation */}
      <div className="px-4 h-12 flex items-center gap-2 overflow-visible bg-slate-950/30 border-b border-slate-800 relative">
          
          {/* Main Items (Left Side) */}
          {navItems.filter(item => item.id !== AppView.LOGS).map((item) => {
              if (item.isDropdown && item.children) {
                  return (
                    <div key={item.id} className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setIsUploadDropdownOpen(!isUploadDropdownOpen)}
                            className={`
                                flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all
                                ${isCurrentViewInUploads 
                                    ? 'bg-tally-600 text-white shadow-md shadow-tally-900/20 translate-y-[-1px]' 
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}
                            `}
                        >
                            <item.icon className="w-3.5 h-3.5" />
                            <span>{item.label}</span>
                            <ChevronDown className={`w-3 h-3 transition-transform ${isUploadDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isUploadDropdownOpen && (
                            <div className="absolute top-full left-0 mt-2 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1 z-50 animate-fade-in">
                                {item.children.map(child => (
                                    <button
                                        key={child.id}
                                        onClick={() => { onChangeView(child.id); setIsUploadDropdownOpen(false); }}
                                        className={`
                                            flex items-center gap-3 w-full px-4 py-2.5 text-xs font-medium text-left hover:bg-slate-800 transition-colors first:rounded-t-lg last:rounded-b-lg
                                            ${currentView === child.id ? 'text-tally-400 bg-slate-800/50' : 'text-slate-300'}
                                        `}
                                    >
                                        <child.icon className="w-4 h-4" />
                                        {child.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                  );
              }

              return (
                <button
                    key={item.id}
                    onClick={() => onChangeView(item.id as AppView)}
                    className={`
                        flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all
                        ${currentView === item.id 
                            ? 'bg-tally-600 text-white shadow-md shadow-tally-900/20 translate-y-[-1px]' 
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}
                    `}
                >
                    <item.icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                </button>
              );
          })}

          {/* Spacer to push remaining items to right */}
          <div className="flex-1" />

          {/* Logs Item (Right Side) */}
          {navItems.filter(item => item.id === AppView.LOGS).map(item => (
               <button
                    key={item.id}
                    onClick={() => onChangeView(item.id as AppView)}
                    className={`
                        flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all
                        ${currentView === item.id 
                            ? 'bg-tally-600 text-white shadow-md shadow-tally-900/20 translate-y-[-1px]' 
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}
                    `}
                >
                    <item.icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                </button>
          ))}

          {/* Tax Calc Button (Far Right) */}
          <button
              onClick={() => setShowCalculator(!showCalculator)}
              className={`
                  flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all
                  ${showCalculator 
                      ? 'bg-indigo-600 text-white shadow-md translate-y-[-1px]' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}
              `}
          >
              <Calculator className="w-3.5 h-3.5" />
              <span>Tax Calc</span>
          </button>

          {showCalculator && <AccountingCalculator onClose={() => setShowCalculator(false)} />}
      </div>
    </div>
  );
};

export default Navbar;
