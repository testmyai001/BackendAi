import React from 'react';
import { InvoiceData } from '../types';

interface JsonViewerProps {
  data: InvoiceData;
}

const JsonViewer: React.FC<JsonViewerProps> = ({ data }) => {
  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 transition-colors duration-200">
       <div className="px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <span className="text-slate-500 dark:text-slate-400 font-mono text-sm">normalized_invoice.json</span>
      </div>
      <div className="flex-1 p-4 overflow-auto">
        <pre className="text-xs font-mono text-slate-700 dark:text-slate-300">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
};

export default JsonViewer;