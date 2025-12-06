import React, { useState, useEffect } from "react";
import { Lock, ShieldCheck, ArrowRight, AlertCircle } from "lucide-react";
import { savePin, verifyPin, hasPinSetup } from "../services/authService";

interface AuthScreenProps {
  onAuthenticated: () => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!hasPinSetup()) setMode("setup");
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    await new Promise(r => setTimeout(r, 500));
    try {
      if (await verifyPin(pin)) {
        onAuthenticated();
      } else {
        setError("Incorrect PIN");
        setPin("");
      }
    } catch {
      setError("Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) { setError("PIN must be at least 4 digits"); return; }
    if (pin !== confirmPin) { setError("PINs do not match"); return; }
    setIsLoading(true);
    await savePin(pin);
    setIsLoading(false);
    onAuthenticated();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-fade-in">
        <div className="bg-slate-900 p-8 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20"></div>
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-4 shadow-xl border border-slate-700">
              {mode === "setup" ? <ShieldCheck className="w-8 h-8 text-emerald-400" /> : <Lock className="w-8 h-8 text-indigo-400" />}
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">AutoTally AI</h1>
            <p className="text-slate-400 text-sm">Secure Automation Environment</p>
          </div>
        </div>
        <div className="p-8">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white text-center mb-6">
            {mode === "setup" ? "Create Security PIN" : "Enter PIN to Unlock"}
          </h2>
          <form onSubmit={mode === "setup" ? handleSetup : handleLogin} className="space-y-4">
            <div>
              <input
                type="password"
                value={pin}
                onChange={(e) => { setPin(e.target.value); setError(""); }}
                className="w-full px-4 py-4 text-center text-2xl font-bold tracking-widest bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                placeholder=""
                autoFocus
                maxLength={8}
              />
            </div>
            {mode === "setup" && (
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2 text-center">Confirm PIN</label>
                <input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => { setConfirmPin(e.target.value); setError(""); }}
                  className="w-full px-4 py-4 text-center text-2xl font-bold tracking-widest bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  placeholder=""
                  maxLength={8}
                />
              </div>
            )}
            {error && (
              <div className="flex items-center justify-center gap-2 text-red-500 text-sm font-medium bg-red-50 dark:bg-red-900/10 py-2 rounded-lg">
                <AlertCircle className="w-4 h-4" /> {error}
              </div>
            )}
            <button
              type="submit"
              disabled={isLoading || !pin}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${isLoading ? "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}
            >
              {isLoading ? "Verifying..." : mode === "setup" ? "Set PIN & Continue" : "Unlock"}
              {!isLoading && <ArrowRight className="w-5 h-5" />}
            </button>
          </form>
          {mode === "setup" && <p className="text-xs text-center text-slate-400 mt-6">This PIN will be stored locally in your browser.</p>}
        </div>
        <div className="bg-slate-50 dark:bg-slate-900/50 p-4 border-t border-slate-200 dark:border-slate-800 flex justify-center">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <ShieldCheck className="w-3 h-3" /> End-to-End Encrypted (Local)
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
