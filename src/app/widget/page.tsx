'use client';

import { useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQa, ComparisonItem, QaInputs } from '@/context/QaContext';
import { 
  Search, CheckCircle2, XCircle, Download, ArrowRight, 
  Database, Zap, FileJson, Layers, Filter, Copy
} from 'lucide-react';

type Environment = 'regular' | 'refactor';

export default function WidgetComparePage() {
  const router = useRouter();
  const { setQaState, updateQaState } = useQa();
  const resultsRef = useRef<HTMLDivElement>(null);

  /* ================================
     STATE MANAGEMENT
  ================================ */
  const [inputs, setInputs] = useState<QaInputs>({
    regUrl: '', regToken: '', regDashId: '', regWidgetId: '',
    refUrl: '', refToken: '', refDashId: '', refWidgetId: ''
  });

  const [regularData, setRegularData] = useState<any | null>(null);
  const [refactorData, setRefactorData] = useState<any | null>(null);
  const [comparisonReport, setComparisonReport] = useState<ComparisonItem[]>([]);
  
  const [loading, setLoading] = useState({ regular: false, refactor: false, compare: false });
  const [error, setError] = useState('');
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [hasCompared, setHasCompared] = useState(false);

  // Filtered report for the UI
  const filteredReport = useMemo(() => 
    showDiffOnly ? comparisonReport.filter(r => !r.isMatch) : comparisonReport
  , [comparisonReport, showDiffOnly]);

  /* ============================================================
     DEEP COMPARISON ENGINE
     ============================================================ */
  const getFullComparison = (obj1: any, obj2: any, path = ''): ComparisonItem[] => {
    const isLeaf = (val: any) => 
      val === null || 
      typeof val !== 'object' || 
      (Array.isArray(val) && val.length === 0) || 
      (typeof val === 'object' && Object.keys(val).length === 0);

    if (isLeaf(obj1) || isLeaf(obj2)) {
      return [{
        path: path || 'root',
        regularValue: obj1,
        refactorValue: obj2,
        isMatch: JSON.stringify(obj1) === JSON.stringify(obj2)
      }];
    }

    const allKeys = Array.from(new Set([...Object.keys(obj1), ...Object.keys(obj2)]));
    return allKeys.flatMap(key => {
      const currentPath = path ? `${path}.${key}` : key;
      return getFullComparison(obj1[key], obj2[key], currentPath);
    });
  };

  /* ================================
     HANDLERS
  ================================ */
  const handleInputChange = (field: keyof QaInputs, value: string) => {
    setInputs(prev => ({ ...prev, [field]: value }));
  };

  const handleFetch = async (env: Environment) => {
    const isReg = env === 'regular';
    const config = isReg ? 
      { url: inputs.regUrl, token: inputs.regToken, dId: inputs.regDashId, wId: inputs.regWidgetId } :
      { url: inputs.refUrl, token: inputs.refToken, dId: inputs.refDashId, wId: inputs.refWidgetId };

    if (!config.url || !config.token) {
      setError(`Credentials required for ${env} fetch.`);
      return;
    }

    setError('');
    setLoading(prev => ({ ...prev, [env]: true }));

    try {
      const res = await fetch('/api/widget/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url.trim(),
          token: config.token.trim(),
          dashboardId: config.dId.trim(),
          widgetId: config.wId.trim(),
          environment: env
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Fetch failed');

      isReg ? setRegularData(json.data) : setRefactorData(json.data);
      setHasCompared(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(prev => ({ ...prev, [env]: false }));
    }
  };

  const runComparison = () => {
    if (!regularData || !refactorData) return;
    setLoading(prev => ({ ...prev, compare: true }));

    const report = getFullComparison(regularData, refactorData);
    setComparisonReport(report);
    setHasCompared(true);
    setLoading(prev => ({ ...prev, compare: false }));

    // Sync to Global Context
    setQaState(prev => ({
      ...prev,
      inputs,
      regularData,
      refactorData,
      comparisonReport: report,
      phase: 'DATA_AUDIT_PENDING',
      createdAt: new Date().toISOString()
    }));

    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleExportCSV = () => {
    const headers = ['Status', 'Path', 'Legacy Value', 'Refactor Value'].join(',');
    const rows = comparisonReport.map(r => [
      r.isMatch ? 'MATCH' : 'DIFF',
      `"${r.path}"`,
      `"${JSON.stringify(r.regularValue)?.replace(/"/g, '""')}"`,
      `"${JSON.stringify(r.refactorValue)?.replace(/"/g, '""')}"`
    ].join(',')).join('\n');

    const blob = new Blob([headers + '\n' + rows], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Audit_Report_${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-20 font-sans">
      
      {/* NAVBAR */}
      <nav className="bg-white/90 backdrop-blur-sm border-b h-16 sticky top-0 z-50 flex items-center px-8 shadow-sm">
        <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Layers className="text-blue-600" size={24} />
            <span className="font-black uppercase tracking-tighter text-xl text-slate-800">Quality Lab</span>
          </div>
          {hasCompared && (
            <button 
              onClick={() => router.push('/data-audit')} 
              className="bg-slate-900 text-white px-6 py-2 rounded-full text-xs font-black flex items-center gap-2 transition-all hover:bg-blue-600 shadow-lg shadow-slate-200"
            >
              PROCEED TO AUDIT <ArrowRight size={14} />
            </button>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-8 space-y-10">
        
        {/* INPUTS & PREVIEWS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {(['regular', 'refactor'] as Environment[]).map(env => {
            const isReg = env === 'regular';
            const data = isReg ? regularData : refactorData;
            const isLoading = isReg ? loading.regular : loading.refactor;
            const prefix = isReg ? 'reg' : 'ref';

            return (
              <div key={env} className="space-y-6">
                <section className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-sm">
                   <h2 className={`text-xs font-black uppercase mb-6 flex items-center gap-2 ${isReg ? 'text-rose-500' : 'text-emerald-500'}`}>
                    <Database size={14} /> {isReg ? 'Source: Legacy (Old)' : 'Target: Refactor (New)'}
                  </h2>
                  <div className="space-y-3">
                    <InputField placeholder="API Base URL" value={inputs[`${prefix}Url` as keyof QaInputs]} onChange={v => handleInputChange(`${prefix}Url` as keyof QaInputs, v)} />
                    <InputField placeholder="Bearer Token" type="password" value={inputs[`${prefix}Token` as keyof QaInputs]} onChange={v => handleInputChange(`${prefix}Token` as keyof QaInputs, v)} />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField placeholder="Dashboard ID" value={inputs[`${prefix}DashId` as keyof QaInputs]} onChange={v => handleInputChange(`${prefix}DashId` as keyof QaInputs, v)} />
                      <InputField placeholder="Widget ID" value={inputs[`${prefix}WidgetId` as keyof QaInputs]} onChange={v => handleInputChange(`${prefix}WidgetId` as keyof QaInputs, v)} />
                    </div>
                    <button 
                      onClick={() => handleFetch(env)} 
                      disabled={isLoading}
                      className={`w-full py-4 rounded-2xl text-white font-black text-xs uppercase tracking-widest transition-all active:scale-95 ${isReg ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'} disabled:opacity-50 shadow-lg shadow-slate-100`}
                    >
                      {isLoading ? 'Fetching Data...' : `Fetch ${env} payload`}
                    </button>
                  </div>
                </section>

                {data && (
                  <div className="bg-[#0F172A] rounded-[2rem] border border-slate-800 overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-[#1e293b]/50">
                      <span className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-2 italic">
                        <FileJson size={14} className="text-blue-400" /> Payload Received
                      </span>
                    </div>
                    <pre className="p-6 text-[12px] text-emerald-400 font-mono overflow-y-auto max-h-[300px] custom-scrollbar leading-relaxed">
                      {JSON.stringify(data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* COMPARISON TRIGGER */}
        <div className="flex flex-col items-center justify-center py-12 border-y border-slate-200">
          <button 
            onClick={runComparison} 
            disabled={!regularData || !refactorData || loading.compare} 
            className="group px-16 py-6 bg-blue-600 text-white rounded-[2rem] font-black text-xl shadow-2xl shadow-blue-200 transition-all hover:-translate-y-1 active:scale-95 flex items-center gap-4 disabled:bg-slate-300 disabled:shadow-none"
          >
            <Zap className={loading.compare ? 'animate-pulse' : ''} fill="currentColor" />
            {loading.compare ? 'ANALYZING PAYLOADS...' : 'RUN FULL AUDIT COMPARISON'}
          </button>
          {error && <p className="mt-4 text-rose-600 font-bold bg-rose-50 px-4 py-2 rounded-xl border border-rose-100 flex items-center gap-2"><XCircle size={16}/> {error}</p>}
        </div>

        {/* RESULTS SECTION */}
        {hasCompared && (
          <div ref={resultsRef} className="space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-700">
            
            {/* STATS CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <StatCard label="Total Audit Points" val={comparisonReport.length} icon={<Search className="text-slate-300"/>} />
              <StatCard label="Mismatches" val={comparisonReport.filter(r => !r.isMatch).length} color="text-rose-600" icon={<XCircle className="text-rose-400"/>} />
              <StatCard label="Matches" val={comparisonReport.filter(r => r.isMatch).length} color="text-emerald-600" icon={<CheckCircle2 className="text-emerald-400"/>} />
              <div className="bg-white p-8 rounded-[2rem] border border-slate-200 flex flex-col justify-center items-center gap-2">
                <p className="text-[10px] font-black uppercase text-slate-400">View Filter</p>
                <button 
                  onClick={() => setShowDiffOnly(!showDiffOnly)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${showDiffOnly ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}`}
                >
                  <Filter size={14} /> {showDiffOnly ? 'Diff Only' : 'Show All'}
                </button>
              </div>
            </div>

            {/* AUDIT LOG TABLE */}
            <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-xl overflow-hidden">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-20">
                <h3 className="font-black text-2xl italic text-slate-800">Audit Logs</h3>
                <button onClick={handleExportCSV} className="bg-slate-900 text-white px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-blue-600 transition-all shadow-lg shadow-slate-200">
                  <Download size={14} /> Export CSV
                </button>
              </div>

              <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr className="border-b">
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Status</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Object Path</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Legacy Value</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Refactor Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredReport.map((r, i) => (
                      <tr key={i} className={`group hover:bg-slate-50 transition-colors ${!r.isMatch ? 'bg-rose-50/20' : ''}`}>
                        <td className="p-6">
                           <span className={`inline-flex items-center gap-1 text-[9px] font-black px-2.5 py-1 rounded-full border ${r.isMatch ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-rose-100 text-rose-700 border-rose-200'}`}>
                            {r.isMatch ? 'MATCH' : 'DIFF'}
                          </span>
                        </td>
                        <td className="p-6">
                          <div className="flex items-center gap-2">
                            <code className="text-[11px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">{r.path}</code>
                            <button onClick={() => navigator.clipboard.writeText(r.path)} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-500">
                              <Copy size={12}/>
                            </button>
                          </div>
                        </td>
                        <td className="p-6 text-[11px] font-mono text-slate-500 truncate max-w-[200px]">{JSON.stringify(r.regularValue)}</td>
                        <td className={`p-6 text-[11px] font-mono truncate max-w-[200px] ${!r.isMatch ? 'text-rose-600 font-black' : 'text-slate-500'}`}>{JSON.stringify(r.refactorValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
}

/* ================================
   HELPER COMPONENTS
================================ */

function InputField({ onChange, ...props }: any) {
  return (
    <input 
      {...props}
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
    />
  );
}

function StatCard({ label, val, icon, color = "text-slate-800" }: any) {
  return (
    <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm flex items-center justify-between transition-transform hover:scale-[1.02]">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">{label}</p>
        <p className={`text-4xl font-black ${color}`}>{val}</p>
      </div>
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner">
        {icon}
      </div>
    </div>
  );
}