'use client';

import { useState } from 'react';
import { useQa } from '@/context/QaContext';
import { 
  Database, Zap, FileJson, CheckCircle2, XCircle, 
  ArrowRight, Activity, Layers, ChevronRight, RefreshCcw,
  Download, Table as TableIcon, Check, AlertTriangle
} from 'lucide-react';

const prepareJaqlBody = (widgetJson: any) => {
  if (!widgetJson || !widgetJson.panels) return null;
  const metadata = widgetJson.panels.flatMap((panel: any) => 
    (panel.items || []).map((item: any) => ({
      jaql: item.jaql,
      panel: panel.name 
    }))
  );
  return { datasource: widgetJson.datasource, metadata };
};

export default function DataAuditPage() {
  const { inputs, regularData, refactorData, updateQaState } = useQa();

  const [results, setResults] = useState<{ regular: any; refactor: any }>({ regular: null, refactor: null });
  const [loading, setLoading] = useState({ regular: false, refactor: false });
  const [error, setError] = useState('');
  
  const [comparison, setComparison] = useState<{
    match: boolean;
    regCount: number;
    refCount: number;
    diffRows: { index: number; reg: any; ref: any; isRowMatch: boolean }[];
  } | null>(null);

  const fetchData = async (env: 'regular' | 'refactor') => {
    // 1. CHOOSE THE CORRECT TOKEN BASED ON THE ENVIRONMENT
    const isRegular = env === 'regular';
    const widgetJson = isRegular ? regularData : refactorData;
    
    const config = isRegular 
      ? { url: inputs?.regUrl, token: inputs?.regToken, label: "LEGACY (OLD)" } 
      : { url: inputs?.refUrl, token: inputs?.refToken, label: "REFACTOR (NEW)" };

    // --- LOGGING TO PROVE THEY ARE SEPARATE ---
    console.group(`📡 Data Fetch: ${config.label}`);
    console.log(`Target Environment: ${env}`);
    console.log(`URL being used: ${config.url}`);
    console.log(`Token being used: ${config.token ? 'EXISTS (starts with ' + config.token.substring(0, 10) + '...)' : 'MISSING'}`);
    console.groupEnd();

    if (!widgetJson || !config.url || !config.token) {
      setError(`Credentials (URL/Token) for ${config.label} are missing. Go back to Step 1.`);
      return;
    }

    setLoading(prev => ({ ...prev, [env]: true }));
    setError('');

    try {
      const jaqlBody = prepareJaqlBody(widgetJson);
      const res = await fetch('/api/widget/jaql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: config.url,
          token: config.token, // This is the specific token for this environment
          datasource: widgetJson.datasource.fullname,
          jaql: jaqlBody
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch data');

      setResults(prev => ({ ...prev, [env]: json.data }));
    } catch (e: any) {
      setError(`${config.label} Error: ${e.message}`);
    } finally {
      setLoading(prev => ({ ...prev, [env]: false }));
    }
  };

  const runDataComparison = () => {
    if (!results.regular || !results.refactor) return;

    const regValues = results.regular.values || [];
    const refValues = results.refactor.values || [];
    
    const maxLength = Math.max(regValues.length, refValues.length);
    const diffRows = [];

    for (let i = 0; i < maxLength; i++) {
      const regRow = regValues[i];
      const refRow = refValues[i];
      const isRowMatch = JSON.stringify(regRow) === JSON.stringify(refRow);
      
      diffRows.push({
        index: i,
        reg: regRow || null,
        ref: refRow || null,
        isRowMatch
      });
    }

    const isMatch = JSON.stringify(regValues) === JSON.stringify(refValues);

    setComparison({
      match: isMatch,
      regCount: regValues.length,
      refCount: refValues.length,
      diffRows
    });

    updateQaState({
      phase: 'DATA_COMPARE_DONE',
      dataCompareResult: {
        regularRowCount: regValues.length,
        refactorRowCount: refValues.length,
        mismatches: isMatch ? 0 : 1
      }
    });
  };

  const handleExportCSV = () => {
    if (!comparison) return;

    const headers = ['Row Index', 'Status', 'Legacy Data', 'Refactor Data'].join(',');
    const rows = comparison.diffRows.map(r => [
      r.index + 1,
      r.isRowMatch ? 'MATCH' : 'MISMATCH',
      `"${JSON.stringify(r.reg).replace(/"/g, '""')}"`,
      `"${JSON.stringify(r.ref).replace(/"/g, '""')}"`
    ].join(','));

    const blob = new Blob([headers + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Data_Audit_Report_${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-20 font-sans">
      
      {/* NAVBAR */}
      <div className="bg-white border-b px-8 py-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="bg-blue-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Phase 2</span>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight italic">Data Audit</h1>
            </div>
            <p className="text-slate-500 text-sm font-medium">Comparing Legacy vs Refactor results using independent authentication tokens.</p>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto p-8 space-y-10">
        
        {/* CONNECTION CONTEXT SECTION */}
        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-6 flex items-center gap-2 italic">
            <Layers size={14} /> Connection Context
          </h2>
          <div className="grid grid-cols-2 gap-12">
            <ContextDetail label="Legacy Environment (OLD)" url={inputs?.regUrl} ds={regularData?.datasource?.fullname} />
            <ContextDetail label="Refactor Environment (NEW)" url={inputs?.refUrl} ds={refactorData?.datasource?.fullname} />
          </div>
        </section>

        {/* FETCH BUTTONS */}
        <div className="grid grid-cols-2 gap-8">
          {(['regular', 'refactor'] as const).map(env => (
            <button key={env} onClick={() => fetchData(env)} disabled={loading[env]}
              className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg
                ${env === 'regular' ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-100' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-100'} text-white disabled:opacity-50`}
            >
              {loading[env] ? <Activity className="animate-spin" /> : <RefreshCcw size={16} />}
              Fetch {env === 'regular' ? 'Legacy' : 'Refactor'} Data
            </button>
          ))}
        </div>

        {/* RAW PREVIEWS */}
        {!comparison && (
          <div className="grid grid-cols-2 gap-8">
            {(['regular', 'refactor'] as const).map(env => (
              <div key={env} className="bg-[#0F172A] rounded-[2.5rem] h-[300px] overflow-hidden shadow-2xl flex flex-col border border-slate-800">
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase italic flex items-center gap-2">
                    <FileJson size={14} className="text-blue-400" /> {env}_payload.json
                  </span>
                </div>
                <pre className="p-6 text-[11px] text-emerald-400 font-mono overflow-auto flex-1 custom-scrollbar">
                  {results[env] ? JSON.stringify(results[env].values, null, 2) : "// Data not yet loaded..."}
                </pre>
              </div>
            ))}
          </div>
        )}

        {/* RUN AUDIT BUTTON */}
        <div className="flex flex-col items-center py-6 border-y border-slate-200">
          <button 
            onClick={runDataComparison}
            disabled={!results.regular || !results.refactor}
            className="group bg-blue-600 text-white px-16 py-6 rounded-[2.5rem] font-black text-xl shadow-2xl shadow-blue-200 hover:-translate-y-1 transition-all disabled:bg-slate-300 flex items-center gap-4"
          >
            <Zap fill="currentColor" /> RUN DATA COMPARISON
          </button>
        </div>

        {/* SIDE BY SIDE RESULTS */}
        {comparison && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-10 duration-700">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <StatBox label="Legacy Rows" val={comparison.regCount} />
              <StatBox label="Refactor Rows" val={comparison.refCount} />
              <StatBox label="Audit Result" val={comparison.match ? "PASSED" : "FAILED"} color={comparison.match ? "text-emerald-500" : "text-rose-500"} />
            </div>

            <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-xl overflow-hidden">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <h3 className="font-black text-2xl italic text-slate-800">Side-by-Side Comparison</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Row-by-row deep value audit</p>
                </div>
                <button 
                  onClick={handleExportCSV}
                  className="bg-slate-900 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-blue-600 transition-all shadow-lg shadow-slate-200"
                >
                  <Download size={14} /> Download CSV Report
                </button>
              </div>

              <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 z-10 border-b">
                    <tr>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 w-20 text-center">#</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 w-32">Status</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400">Legacy Result (OLD)</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400">Refactor Result (NEW)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {comparison.diffRows.map((row) => (
                      <tr key={row.index} className={`group hover:bg-slate-50 transition-colors ${!row.isRowMatch ? 'bg-rose-50/40' : ''}`}>
                        <td className="p-6 text-xs font-bold text-slate-300 text-center">{row.index + 1}</td>
                        <td className="p-6">
                          {row.isRowMatch ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                              <Check size={10} /> MATCH
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                              <AlertTriangle size={10} /> MISMATCH
                            </span>
                          )}
                        </td>
                        <td className="p-6 align-top">
                          <pre className={`text-[11px] font-mono leading-relaxed ${!row.isRowMatch ? 'text-rose-600' : 'text-slate-600'}`}>
                            {row.reg ? JSON.stringify(row.reg, null, 2) : <span className="italic text-slate-300 text-[10px]">NULL</span>}
                          </pre>
                        </td>
                        <td className="p-6 align-top">
                          <pre className={`text-[11px] font-mono leading-relaxed ${!row.isRowMatch ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>
                            {row.ref ? JSON.stringify(row.ref, null, 2) : <span className="italic text-slate-300 text-[10px]">NULL</span>}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex items-center gap-3 text-rose-600 font-bold">
            <XCircle size={20} /> {error}
          </div>
        )}
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
      `}</style>
    </div>
  );
}

function ContextDetail({ label, url, ds }: any) {
  return (
    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
      <h4 className="font-black text-slate-800 text-[10px] uppercase mb-2 tracking-widest">{label}</h4>
      <p className="text-[11px] font-mono text-slate-500 truncate mb-1">Base: {url || 'N/A'}</p>
      <p className="text-[11px] font-mono text-blue-600 truncate font-bold">Datasource: {ds || 'N/A'}</p>
    </div>
  );
}

function StatBox({ label, val, color = "text-slate-900" }: any) {
  return (
    <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center shadow-sm">
      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3 italic">{label}</p>
      <p className={`text-4xl font-black tracking-tighter ${color}`}>{val}</p>
    </div>
  );
}