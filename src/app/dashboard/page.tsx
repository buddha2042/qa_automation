'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardWelcomePage() {
  const router = useRouter();
  
  // State 
  const [formData, setFormData] = useState({
    oid: '',
    jwt1: '',
    jwt2: ''
  });

  const [isLoading, setIsLoading] = useState(false);

  // Handle input changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleStart = (e) => {
    e.preventDefault();
    if (!formData.oid || !formData.jwt1 || !formData.jwt2) return;
    
    setIsLoading(true);

    // Store tokens in LocalStorage to keep URL clean and avoid length limits
    // In a real app, you might use a secure context or HttpOnly cookies
    localStorage.setItem('dxc_qa_jwt_env1', formData.jwt1);
    localStorage.setItem('dxc_qa_jwt_env2', formData.jwt2);

    setTimeout(() => {
      // Navigate to the scan page with just the OID in the URL
      router.push(`/dashboard/scan?oid=${formData.oid}`);
    }, 800);
  };

  // Helper to check if form is valid
  const isValid = formData.oid.length > 5 && formData.jwt1.length > 20 && formData.jwt2.length > 20;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex flex-col relative overflow-hidden">
      
      {/* --- Background Effects --- */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[50%] h-[50%] bg-indigo-50/60 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] bg-blue-50/60 blur-[100px] rounded-full" />
      </div>

      {/* --- Nav --- */}
      <nav className="w-full border-b border-slate-200 bg-white/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <div 
            onClick={() => router.push('/')} 
            className="cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-2 group"
          >
            <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center group-hover:border-slate-400">
              <svg className="w-3 h-3 text-slate-400 group-hover:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 group-hover:text-slate-600">Back to Hub</span>
          </div>
          <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-3 py-1 rounded-md">
            Dashboard Inspector
          </div>
        </div>
      </nav>

      {/* --- Main Form Area --- */}
      <main className="flex-grow flex flex-col items-center justify-center px-6 py-12">
        
        <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-[32px] shadow-xl shadow-slate-200/50 p-8 md:p-10 relative overflow-hidden">
          
          {/* Header */}
          <div className="text-center mb-10">
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 mb-2 uppercase italic tracking-tight">
              Cross-Env <span className="text-indigo-600">Comparison</span>
            </h1>
            <p className="text-slate-500 text-sm font-medium max-w-md mx-auto leading-relaxed">
              Configure your session. .
            </p>
          </div>

          <form onSubmit={handleStart} className="space-y-6">
            
            {/* 1. Dashboard ID */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                Target Dashboard ID (OID)
              </label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                  </svg>
                </div>
                <input 
                  type="text" 
                  name="oid"
                  value={formData.oid}
                  onChange={handleChange}
                  placeholder="e.g. 64aef2..."
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm font-bold rounded-xl pl-12 pr-4 py-4 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all placeholder:text-slate-300 placeholder:font-normal"
                />
              </div>
            </div>

            {/* Split Grid for Tokens */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* 2. Environment 1 Token */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                  Environment 1 (Source) <span className="text-indigo-500">JWT</span>
                </label>
                <div className="relative">
                  <textarea 
                    name="jwt1"
                    value={formData.jwt1}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Paste Bearer Token..."
                    className="w-full bg-slate-50 border border-slate-200 text-xs font-mono text-slate-600 rounded-xl p-4 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all resize-none placeholder:text-slate-300"
                  />
                  <div className="absolute right-3 top-3">
                     <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                  </div>
                </div>
              </div>

              {/* 3. Environment 2 Token */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                  Environment 2 (Source) <span className="text-blue-500">JWT</span>
                </label>
                <div className="relative">
                  <textarea 
                    name="jwt2"
                    value={formData.jwt2}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Paste Bearer Token..."
                    className="w-full bg-slate-50 border border-slate-200 text-xs font-mono text-slate-600 rounded-xl p-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all resize-none placeholder:text-slate-300"
                  />
                   <div className="absolute right-3 top-3">
                     <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                  </div>
                </div>
              </div>

            </div>

            {/* Submit Button */}
            <button 
              type="submit"
              disabled={!isValid || isLoading}
              className={`w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2 mt-4
                ${!isValid 
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-200 active:scale-95'}
              `}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Authenticating...
                </>
              ) : (
                <>
                  Start Audit Sequence →
                </>
              )}
            </button>
          </form>

          {/* Quick Info Grid */}
          <div className="mt-8 pt-6 border-t border-slate-100 flex justify-between px-4">
             <div className="text-center">
                <p className="text-[10px] text-slate-400 font-bold uppercase">Mapping</p>
                <p className="text-xs font-black text-slate-700">Strict ID</p>
             </div>
             <div className="w-px h-8 bg-slate-100"></div>
             <div className="text-center">
                <p className="text-[10px] text-slate-400 font-bold uppercase">Depth</p>
                <p className="text-xs font-black text-slate-700">Full Widget</p>
             </div>
             <div className="w-px h-8 bg-slate-100"></div>
             <div className="text-center">
                <p className="text-[10px] text-slate-400 font-bold uppercase">Output</p>
                <p className="text-xs font-black text-slate-700">Diff Report</p>
             </div>
          </div>

        </div>
      </main>


      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
        body { font-family: 'Inter', sans-serif; background-color: #f8fafc; }
      `}</style>
    </div>
  );
}