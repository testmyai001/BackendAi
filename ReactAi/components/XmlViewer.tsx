import React, { useMemo } from 'react';
import { InvoiceData } from '../types';
import { generateTallyXml } from '../services/tallyService';
import { Copy, Check, Code } from 'lucide-react';

interface XmlViewerProps {
  data: InvoiceData;
}

const XmlViewer: React.FC<XmlViewerProps> = ({ data }) => {
  const [copied, setCopied] = React.useState(false);

  const xmlContent = useMemo(() => {
    return generateTallyXml(data);
  }, [data]);

  const handleCopy = () => {
    navigator.clipboard.writeText(xmlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-slate-700">
      <div className="flex justify-between items-center px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
            <Code className="w-4 h-4 text-tally-400" />
            <span className="text-slate-300 font-mono text-sm">tally_request_payload.xml</span>
        </div>
        <button 
          onClick={handleCopy}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-xs font-medium text-slate-300 hover:text-white transition-colors border border-slate-600 hover:border-slate-500"
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied to Clipboard' : 'Copy XML'}
        </button>
      </div>
      <pre className="flex-1 p-4 overflow-auto text-xs font-mono text-emerald-300 leading-relaxed whitespace-pre-wrap">
        <code>{xmlContent}</code>
      </pre>
      <div className="px-4 py-2 bg-slate-800/50 border-t border-slate-700 text-xs text-slate-500 flex justify-between">
        <span>Auto-creates Ledgers & Stock Items if missing</span>
        <span>{xmlContent.length} chars</span>
      </div>
    </div>
  );
};

export default XmlViewer;