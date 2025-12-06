import React from 'react';
import { LogEntry } from '../types';
import { Terminal, CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';

interface TallyLogsProps {
  logs: LogEntry[];
}

const TallyLogs: React.FC<TallyLogsProps> = ({ logs }) => {
  return (
    <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden flex flex-col h-[300px]">
      <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <Terminal className="w-4 h-4 text-green-400" />
            <h3 className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wider">Integration Console</h3>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500">
               <span className="flex items-center gap-1"><div className="w-2 h-2 bg-green-500 rounded-full"></div> 200 OK</span>
               <span className="flex items-center gap-1"><div className="w-2 h-2 bg-red-500 rounded-full"></div> ERROR</span>
               <span className="flex items-center gap-1"><div className="w-2 h-2 bg-yellow-500 rounded-full"></div> PENDING</span>
          </div>
      </div>
      
      <div className="flex-1 overflow-auto p-2 font-mono text-xs scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
        <div className="space-y-1">
          {logs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 mt-12">
                <Terminal className="w-12 h-12 mb-4" />
                <p>Waiting for transactions...</p>
            </div>
          )}
          {logs.map((log) => (
            <div key={log.id} className="p-2 rounded hover:bg-slate-800/50 transition-colors group border-l-2 border-transparent hover:border-slate-600">
              <div className="flex items-start gap-3">
                <div className="text-slate-500 w-20 shrink-0 mt-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {log.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                </div>
                
                <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                        <span className={`px-1.5 py-px rounded-[3px] text-[10px] font-bold ${
                            log.method === 'POST' ? 'bg-green-900/30 text-green-400' : 'bg-purple-900/30 text-purple-400'
                        }`}>
                            {log.method}
                        </span>
                        
                        {log.status === 'Success' ? (
                            <span className="flex items-center gap-1 text-green-400 font-bold">
                                <CheckCircle className="w-3 h-3" /> SUCCESS
                            </span>
                        ) : log.status === 'Failed' ? (
                            <span className="flex items-center gap-1 text-red-400 font-bold">
                                <XCircle className="w-3 h-3" /> FAILED
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-yellow-400 font-bold">
                                <Loader2 className="w-3 h-3 animate-spin" /> PENDING
                            </span>
                        )}
                        <span className="text-slate-500 text-[10px]">{log.endpoint}</span>
                    </div>
                    
                    <div className="text-slate-300 pl-1">
                        {log.message}
                    </div>
                    
                    {log.response && (
                        <div className={`mt-2 p-2 rounded border text-[10px] whitespace-pre-wrap overflow-hidden ${
                            log.status === 'Success' 
                            ? 'bg-green-900/10 border-green-900/30 text-green-300' 
                            : 'bg-red-900/10 border-red-900/30 text-red-300'
                        }`}>
                            <span className="opacity-50 select-none">$ response: </span>
                            {log.response}
                        </div>
                    )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TallyLogs;