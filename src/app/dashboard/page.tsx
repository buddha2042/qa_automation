'use client';

import { FormEvent, ChangeEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQa } from '@/context/QaContext';

interface DashboardSetupForm {
  oid: string;
  regUrl: string;
  refUrl: string;
  jwt1: string;
  jwt2: string;
}

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export default function DashboardWelcomePage() {
  const router = useRouter();
  const { setQaState } = useQa();

  const [formData, setFormData] = useState<DashboardSetupForm>({
    oid: '',
    regUrl: '',
    refUrl: '',
    jwt1: '',
    jwt2: '',
  });

  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const isValid = useMemo(() => {
    return (
      formData.oid.trim().length > 5 &&
      isValidHttpUrl(formData.regUrl.trim()) &&
      isValidHttpUrl(formData.refUrl.trim()) &&
      formData.jwt1.trim().length > 20 &&
      formData.jwt2.trim().length > 20
    );
  }, [formData]);

  const handleStart = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isValid) return;

    setIsLoading(true);

    setQaState((prev) => ({
      ...prev,
      inputs: {
        regUrl: formData.regUrl.trim(),
        refUrl: formData.refUrl.trim(),
        regToken: formData.jwt1.trim(),
        refToken: formData.jwt2.trim(),
        regDashId: formData.oid.trim(),
        refDashId: formData.oid.trim(),
        regWidgetId: '',
        refWidgetId: '',
      },
      phase: 'WIDGET_QA_RUNNING',
      createdAt: new Date().toISOString(),
    }));

    setTimeout(() => {
      router.push('/widget');
    }, 350);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex flex-col relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[50%] h-[50%] bg-indigo-50/60 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[10%] w-[40%] h-[40%] bg-blue-50/60 blur-[100px] rounded-full" />
      </div>

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

      <main className="flex-grow flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-[32px] shadow-xl shadow-slate-200/50 p-8 md:p-10 relative overflow-hidden">
          <div className="text-center mb-10">
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 mb-2 uppercase italic tracking-tight">
              Cross-Env <span className="text-indigo-600">Comparison</span>
            </h1>
            <p className="text-slate-500 text-sm font-medium max-w-md mx-auto leading-relaxed">
              Configure dashboard ID, environment URLs, and tokens to start the audit workflow.
            </p>
          </div>

          <form onSubmit={handleStart} className="space-y-6">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                Target Dashboard ID (OID)
              </label>
              <input
                type="text"
                name="oid"
                value={formData.oid}
                onChange={handleChange}
                placeholder="e.g. 64aef2..."
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm font-bold rounded-xl px-4 py-4 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all placeholder:text-slate-300 placeholder:font-normal"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                  Environment 1 Base URL
                </label>
                <input
                  type="url"
                  name="regUrl"
                  value={formData.regUrl}
                  onChange={handleChange}
                  placeholder="https://env-1.example.com"
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-4 py-4 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all placeholder:text-slate-300"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                  Environment 2 Base URL
                </label>
                <input
                  type="url"
                  name="refUrl"
                  value={formData.refUrl}
                  onChange={handleChange}
                  placeholder="https://env-2.example.com"
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-4 py-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all placeholder:text-slate-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                  Environment 1 JWT
                </label>
                <textarea
                  name="jwt1"
                  value={formData.jwt1}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Paste Bearer Token..."
                  className="w-full bg-slate-50 border border-slate-200 text-xs font-mono text-slate-600 rounded-xl p-4 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all resize-none placeholder:text-slate-300"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                  Environment 2 JWT
                </label>
                <textarea
                  name="jwt2"
                  value={formData.jwt2}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Paste Bearer Token..."
                  className="w-full bg-slate-50 border border-slate-200 text-xs font-mono text-slate-600 rounded-xl p-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all resize-none placeholder:text-slate-300"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!isValid || isLoading}
              className={`w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2 mt-4
                ${
                  !isValid
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-200 active:scale-95'
                }
              `}
            >
              {isLoading ? 'Preparing workflow...' : 'Continue to Widget Inspector'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
