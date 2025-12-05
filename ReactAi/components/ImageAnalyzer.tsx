
import React, { useState, useCallback } from 'react';
import { Upload, Loader2, Image as ImageIcon, ScanEye, X, History, ChevronRight, Clock, FileText } from 'lucide-react';
import { analyzeImageWithGemini } from '../services/backendService';
import { v4 as uuidv4 } from 'uuid';

interface AnalysisSession {
    id: string;
    image: File;
    previewUrl: string;
    prompt: string;
    result: string;
    timestamp: Date;
}

const ImageAnalyzer: React.FC = () => {
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  // Temporary state for the "New" analysis
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // If we are viewing a history item
  const currentSession = sessions.find(s => s.id === currentSessionId);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  }, []);

  const handleFile = (file: File) => {
    // Support Images and PDFs
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      // If we were viewing history, reset to "new" mode
      if (currentSessionId) setCurrentSessionId(null);
      
      setImage(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
        alert("Please upload an Image (JPG, PNG) or PDF file.");
    }
  };

  const handleAnalyze = async () => {
    if (!image) return;

    setIsAnalyzing(true);
    
    try {
      const response = await analyzeImageWithGemini(image, prompt);
      
      const newSession: AnalysisSession = {
          id: uuidv4(),
          image,
          previewUrl: previewUrl!,
          prompt,
          result: response,
          timestamp: new Date()
      };
      
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      
      // Clear temp state so if they click "New", it's clean
      setImage(null);
      setPreviewUrl(null);
      setPrompt('');

    } catch (error) {
      console.error(error);
      alert("Error analyzing file. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startNew = () => {
      setCurrentSessionId(null);
      setImage(null);
      setPreviewUrl(null);
      setPrompt('');
  };

  const loadSession = (id: string) => {
      setCurrentSessionId(id);
  };

  // Determine what to display: Current Session data or Temp Data
  const activeFile = currentSession ? currentSession.image : image;
  const displayUrl = currentSession ? currentSession.previewUrl : previewUrl;
  const displayResult = currentSession ? currentSession.result : '';
  const displayPrompt = currentSession ? currentSession.prompt : prompt;

  const isPdf = activeFile?.type === 'application/pdf';

  return (
    <div className="h-full flex gap-6 animate-fade-in">
        
        {/* Left: History Sidebar */}
        <div className="w-64 flex flex-col bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
             <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
                <h3 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 text-sm">
                    <History className="w-4 h-4" />
                    History
                </h3>
                <button 
                    onClick={startNew}
                    className="text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-md font-bold hover:bg-indigo-100 transition-colors"
                >
                    + NEW
                </button>
             </div>
             <div className="flex-1 overflow-y-auto p-2 space-y-2">
                 {sessions.length === 0 && (
                     <div className="text-center p-4 text-xs text-slate-400 italic">
                         No analysis history yet.
                     </div>
                 )}
                 {sessions.map(s => (
                     <button 
                        key={s.id}
                        onClick={() => loadSession(s.id)}
                        className={`w-full text-left p-2 rounded-lg flex items-start gap-3 transition-colors ${currentSessionId === s.id ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                     >
                         {s.image.type === 'application/pdf' ? (
                            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/20 rounded flex items-center justify-center shrink-0">
                                <FileText className="w-5 h-5 text-red-500" />
                            </div>
                         ) : (
                            <img src={s.previewUrl} alt="thumb" className="w-10 h-10 object-cover rounded bg-slate-200 shrink-0" />
                         )}
                         
                         <div className="flex-1 min-w-0">
                             <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{s.image.name}</div>
                             <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                                 <Clock className="w-3 h-3" />
                                 {s.timestamp.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                             </div>
                         </div>
                         {currentSessionId === s.id && <ChevronRight className="w-4 h-4 text-indigo-500 self-center" />}
                     </button>
                 ))}
             </div>
        </div>

        {/* Middle: Main Content */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
             
             {/* Upload / File View */}
             <div className="flex flex-col gap-6 h-full min-h-[400px]">
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col flex-1 transition-colors relative">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <ImageIcon className="w-5 h-5 text-purple-500" />
                            {currentSession ? 'Analyzed Document' : 'Document Input'}
                        </h3>
                        {currentSession && (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-bold">Completed</span>
                        )}
                    </div>
                    
                    <div className="p-6 flex-1 flex flex-col">
                        {!displayUrl ? (
                            <div 
                                className={`
                                flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl transition-all duration-300 p-6 cursor-pointer
                                ${isDragOver 
                                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' 
                                    : 'border-slate-200 dark:border-slate-700 hover:border-purple-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'}
                                `}
                                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                                onDragLeave={() => setIsDragOver(false)}
                                onDrop={handleDrop}
                                onClick={() => document.getElementById('img-upload')?.click()}
                            >
                                <div className="w-16 h-16 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full flex items-center justify-center mb-4">
                                    <Upload className="w-8 h-8" />
                                </div>
                                <p className="font-medium text-slate-700 dark:text-slate-300">Click to upload or drag file</p>
                                <p className="text-xs text-slate-400 mt-2">Supports Images (JPG, PNG) & PDF</p>
                                <input id="img-upload" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                            </div>
                        ) : (
                            <div className="relative flex-1 bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center group">
                                {isPdf ? (
                                    <object data={`${displayUrl}#toolbar=0`} type="application/pdf" className="w-full h-full">
                                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                            <FileText className="w-12 h-12 mb-2" />
                                            <p>PDF Preview</p>
                                        </div>
                                    </object>
                                ) : (
                                    <img src={displayUrl} alt="Preview" className="max-w-full max-h-full object-contain" />
                                )}
                                
                                {!currentSession && (
                                    <button 
                                        onClick={startNew}
                                        className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100 z-10"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Controls - Only show if not viewing history */}
                        {!currentSession && (
                            <div className="mt-6 space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase mb-2">Analysis Prompt (Optional)</label>
                                    <textarea 
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        placeholder="Describe what you want to know... (e.g. 'Read the text', 'Identify objects')"
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none bg-white dark:bg-slate-700 text-slate-900 dark:text-white resize-none h-20"
                                    />
                                </div>
                                <button
                                    onClick={handleAnalyze}
                                    disabled={!image || isAnalyzing}
                                    className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 font-bold text-white transition-all ${
                                        !image || isAnalyzing
                                        ? 'bg-slate-400 cursor-not-allowed'
                                        : 'bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-600/20'
                                    }`}
                                >
                                    {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanEye className="w-5 h-5" />}
                                    {isAnalyzing ? 'Analyze Document' : 'Analyze Document'}
                                </button>
                            </div>
                        )}
                        
                        {currentSession && (
                             <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 italic">
                                 Prompt: "{displayPrompt || 'Standard Analysis'}"
                             </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Results */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-full transition-colors">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                    <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <ScanEye className="w-5 h-5 text-emerald-500" />
                        Analysis Result
                    </h3>
                </div>
                <div className="flex-1 p-6 overflow-auto bg-slate-50/50 dark:bg-slate-900/30">
                    {displayResult ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                            {displayResult}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                            <ScanEye className="w-12 h-12 mb-4" />
                            <p>Result will appear here</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    </div>
  );
};

export default ImageAnalyzer;
