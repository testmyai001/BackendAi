
import React, { useState } from 'react';
import { 
  BarChart2, 
  CheckSquare, 
  AlertTriangle, 
  AlertCircle, 
  FileText, 
  Eye, 
  Download, 
  Search, 
  Filter, 
  RefreshCcw, 
  Loader2,
  UploadCloud,
  Send,
  Landmark,
  FileSpreadsheet
} from 'lucide-react';
import { ProcessedFile } from '../types';

interface DashboardProps {
  files: ProcessedFile[];
  onNavigateToUpload: () => void;
  onView: (file: ProcessedFile) => void;
  onRetry: () => void;
  onPushSuccess: () => void;
  isPushing: boolean;
  onDownload: (file: ProcessedFile) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  filterStatus: string;
  onFilterChange: (status: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ 
  files, 
  onNavigateToUpload, 
  onView, 
  onRetry, 
  onPushSuccess, 
  isPushing,
  onDownload,
  searchTerm,
  onSearchChange,
  filterStatus,
  onFilterChange
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Computed Statistics (based on ALL files, not just filtered)
  const totalFiles = files.length;
  // Successful Invoices counts both "Ready" (OCR Done) and "Success" (Pushed)
  const successFiles = files.filter(f => f.status === 'Success' || f.status === 'Ready').length;
  // Count of invoices explicitly in "Ready" state waiting for push (Invoices only)
  const readyToPushFiles = files.filter(f => f.status === 'Ready' && f.sourceType === 'OCR_INVOICE').length;
  const failedFiles = files.filter(f => f.status === 'Failed').length;
  const processingFiles = files.filter(f => f.status === 'Processing').length;
  
  const totalCorrectEntries = files.reduce((acc, curr) => acc + (curr.correctEntries || 0), 0);
  const totalIncorrectEntries = files.reduce((acc, curr) => acc + (curr.incorrectEntries || 0), 0);

  const processingPercentage = totalFiles === 0 ? 0 : Math.round(((successFiles + failedFiles) / totalFiles) * 100);

  const getSourceIcon = (type: string) => {
      switch(type) {
          case 'BANK_STATEMENT': return <Landmark className="w-4 h-4 text-orange-500" />;
          case 'EXCEL_IMPORT': return <FileSpreadsheet className="w-4 h-4 text-green-600" />;
          default: return <FileText className="w-4 h-4 text-blue-500" />;
      }
  };

  const getSourceLabel = (type: string) => {
      switch(type) {
          case 'BANK_STATEMENT': return 'Bank Statement';
          case 'EXCEL_IMPORT': return 'Excel Import';
          default: return 'Invoice';
      }
  };

  return (
    <div className="flex flex-col h-full gap-6 overflow-y-auto pb-4 scrollbar-hide animate-fade-in relative">
      
      {/* Header Actions Row */}
      <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 relative z-20">
          <div className="flex flex-col">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Overview of all processed files</p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto relative">
             <button 
                onClick={onNavigateToUpload}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium transition-all shadow-md hover:shadow-lg"
             >
                <UploadCloud className="w-4 h-4" />
                Upload New
             </button>

             <button 
                onClick={onPushSuccess}
                disabled={readyToPushFiles === 0 || isPushing}
                className={`
                flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-bold text-white shadow-md transition-all
                ${readyToPushFiles > 0 && !isPushing
                    ? 'bg-emerald-600 hover:bg-emerald-700 hover:-translate-y-0.5 shadow-emerald-600/20' 
                    : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-70 text-slate-500'}
                `}
            >
                {isPushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {isPushing ? 'Pushing...' : `Push Invoices (${readyToPushFiles})`}
            </button>
          </div>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Total Files */}
          <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between h-32 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start">
              <span className="text-4xl font-bold text-slate-800 dark:text-white">{totalFiles}</span>
              <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
              <BarChart2 className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </div>
          </div>
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Files<br/>Uploaded</span>
          </div>

          {/* Successful */}
          <div className="bg-emerald-50 dark:bg-emerald-900/10 p-5 rounded-xl border border-emerald-100 dark:border-emerald-900/30 shadow-sm flex flex-col justify-between h-32 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start">
              <span className="text-4xl font-bold text-emerald-600 dark:text-emerald-500">{successFiles}</span>
              <div className="p-2 bg-emerald-100 dark:bg-emerald-800/30 rounded-lg">
              <CheckSquare className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
              </div>
          </div>
          <span className="text-sm font-medium text-emerald-800 dark:text-emerald-400">Successful<br/>Processed</span>
          </div>

          {/* Failed */}
          <div className="bg-red-50 dark:bg-red-900/10 p-5 rounded-xl border border-red-100 dark:border-red-900/30 shadow-sm flex flex-col justify-between h-32 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start">
              <span className="text-4xl font-bold text-red-600 dark:text-red-500">{failedFiles.toString().padStart(2, '0')}</span>
              <div className="p-2 bg-red-100 dark:bg-red-800/30 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500" />
              </div>
          </div>
          <span className="text-sm font-medium text-red-800 dark:text-red-400">Failed<br/>Files</span>
          </div>

          {/* Correct Entries */}
          <div className="bg-blue-50 dark:bg-blue-900/10 p-5 rounded-xl border border-blue-100 dark:border-blue-900/30 shadow-sm flex flex-col justify-between h-32 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start">
              <span className="text-4xl font-bold text-blue-600 dark:text-blue-500">{totalCorrectEntries}</span>
              <div className="p-2 bg-blue-100 dark:bg-blue-800/30 rounded-lg">
              <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-500" />
              </div>
          </div>
          <span className="text-sm font-medium text-blue-800 dark:text-blue-400">Total Vouchers<br/>Identified</span>
          </div>

          {/* Incorrect Entries */}
          <div className="bg-orange-50 dark:bg-orange-900/10 p-5 rounded-xl border border-orange-100 dark:border-orange-900/30 shadow-sm flex flex-col justify-between h-32 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start">
              <span className="text-4xl font-bold text-orange-600 dark:text-orange-500">{totalIncorrectEntries}</span>
              <div className="p-2 bg-orange-100 dark:bg-orange-800/30 rounded-lg">
              <FileText className="w-5 h-5 text-orange-600 dark:text-orange-500" />
              </div>
          </div>
          <span className="text-sm font-medium text-orange-800 dark:text-orange-400">Incomplete<br/>Entries</span>
          </div>
      </div>

      {/* Invoices Table Section */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex-1 flex flex-col min-h-[400px]">
        {/* Table Header / Toolbar */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="font-bold text-slate-900 dark:text-white text-lg">Recent Files</h3>
          <div className="flex items-center gap-3">
             <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  value={searchTerm}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search invoice, bank, excel..." 
                  className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white w-64"
                />
             </div>
             
             {/* Filter Dropdown */}
             <div className="relative">
                <button 
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className={`p-2 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-2 ${filterStatus !== 'All' ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
                  title="Filter by Status or Type"
                >
                    <Filter className="w-4 h-4" />
                </button>
                {isFilterOpen && (
                   <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in">
                      {['All', 'Invoices', 'Bank', 'Excel', 'Success', 'Ready', 'Failed'].map(status => (
                          <button
                            key={status}
                            onClick={() => { onFilterChange(status); setIsFilterOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${filterStatus === status ? 'font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/10' : 'text-slate-700 dark:text-slate-300'}`}
                          >
                             {status}
                          </button>
                      ))}
                   </div>
                )}
             </div>

             <div className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-400 cursor-default" title="Table Export (Not active)">
                <Download className="w-4 h-4" />
             </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">Type</th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">File Name</th>
                <th className="px-6 py-4 font-semibold text-center whitespace-nowrap">View</th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">Status</th>
                <th className="px-6 py-4 font-semibold text-center whitespace-nowrap">Vouchers</th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">Time Taken</th>
                <th className="px-6 py-4 font-semibold text-right whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {files.length === 0 ? (
                <tr>
                   <td colSpan={8} className="px-6 py-20 text-center text-slate-400 dark:text-slate-500">
                      <div className="flex flex-col items-center gap-3">
                          <FileText className="w-10 h-10 opacity-50" />
                          <p>No files found matching your criteria.</p>
                      </div>
                   </td>
                </tr>
              ) : (
                files.map((file) => (
                  <tr key={file.id} className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4">
                        <div className="flex items-center gap-2" title={getSourceLabel(file.sourceType)}>
                            {getSourceIcon(file.sourceType)}
                            <span className="text-xs text-slate-500 hidden sm:inline">{getSourceLabel(file.sourceType)}</span>
                        </div>
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-white whitespace-nowrap">{file.fileName}</td>
                    <td className="px-6 py-4 text-center">
                        <button 
                          onClick={() => onView(file)}
                          className={`p-1.5 rounded-lg transition-colors inline-block ${
                              file.status === 'Success' || file.status === 'Ready' || file.status === 'Mismatch' || file.sourceType === 'BANK_STATEMENT' || file.sourceType === 'EXCEL_IMPORT'
                              ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100' 
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                           <Eye className="w-4 h-4" />
                        </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5
                            ${file.status === 'Success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : ''}
                            ${file.status === 'Ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                            ${file.status === 'Failed' || file.status === 'Mismatch' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}
                            ${(file.status === 'Processing' || file.status === 'Pending') ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''}
                        `}>
                            {file.status === 'Processing' && <Loader2 className="w-3 h-3 animate-spin" />}
                            {file.status === 'Success' ? 'Completed' : file.status}
                        </span>
                    </td>
                    <td className="px-6 py-4 text-center font-mono font-medium text-slate-700 dark:text-slate-300">
                        {file.correctEntries > 0 ? file.correctEntries : '-'}
                    </td>
                    <td className="px-6 py-4 text-slate-500 whitespace-nowrap">{file.timeTaken}</td>
                    <td className="px-6 py-4 text-right">
                       {file.sourceType === 'OCR_INVOICE' && (
                           <button 
                            onClick={() => onDownload(file)}
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                            title="Download Report"
                           >
                              <Download className="w-5 h-5" />
                           </button>
                       )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer / Progress */}
        <div className="p-6 border-t border-slate-200 dark:border-slate-700">
           {totalFiles > 0 && processingFiles > 0 && (
             <div className="mb-6 bg-slate-50 dark:bg-slate-700/30 p-4 rounded-xl border border-slate-200 dark:border-slate-700/50">
               <div className="flex justify-between text-xs font-semibold mb-2 text-slate-600 dark:text-slate-400">
                  <span className="flex items-center gap-2">
                    Processing 
                    <span className="font-normal text-slate-400">(approx. time remaining: 1 min)</span>
                  </span>
                  <span>{processingFiles}/{totalFiles} processed</span>
               </div>
               <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${processingPercentage}%` }}
                  ></div>
               </div>
             </div>
           )}

           <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                 <span className="text-slate-600 dark:text-slate-400">Total Files: <strong className="text-slate-900 dark:text-white ml-1">{totalFiles}</strong></span>
                 <span className="text-slate-600 dark:text-slate-400">Total Vouchers: <strong className="text-emerald-600 dark:text-emerald-400 ml-1">{totalCorrectEntries}</strong></span>
              </div>

              <button 
                onClick={onRetry}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={failedFiles === 0}
              >
                 <RefreshCcw className={`w-4 h-4 ${failedFiles === 0 ? '' : 'animate-spin-slow'}`} style={{ animationDuration: '3s' }} />
                 Retry Failed
              </button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
