'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQa } from '@/context/QaContext';
import { FileJson, XCircle, Activity, Layers, RefreshCcw, Download, Check, AlertTriangle, ArrowLeft, Zap } from 'lucide-react';

type Env = 'regular' | 'refactor';
type RowValue = unknown[] | string | number | boolean | null | Record<string, unknown>;

interface WidgetPanelItem {
  jaql?: unknown;
}

interface WidgetPanel {
  name?: string;
  items?: WidgetPanelItem[];
}

interface WidgetComparableJson {
  datasource?: { fullname?: string };
  panels?: WidgetPanel[];
}

interface JaqlResponse {
  values?: RowValue[];
}

interface CompareRow {
  index: number;
  reg: RowValue | null;
  ref: RowValue | null;
  isRowMatch: boolean;
}

interface DataComparisonResult {
  match: boolean;
  regCount: number;
  refCount: number;
  mismatchCount: number;
  diffRows: CompareRow[];
}

const prepareJaqlBody = (widgetJson: WidgetComparableJson | null) => {
  if (!widgetJson?.panels) return null;

  const metadata = widgetJson.panels.flatMap((panel) =>
    (panel.items ?? []).map((item) => ({
      jaql: item.jaql,
      panel: panel.name,
    }))
  );

  return { datasource: widgetJson.datasource, metadata };
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export default function DataAuditPage() {
  const router = useRouter();
  const { inputs, regularData, refactorData, updateQaState } = useQa();

  const regularWidget = (regularData ?? null) as WidgetComparableJson | null;
  const refactorWidget = (refactorData ?? null) as WidgetComparableJson | null;

  const missingContext = useMemo(() => !inputs || !regularWidget || !refactorWidget, [inputs, regularWidget, refactorWidget]);

  const [results, setResults] = useState<{ regular: JaqlResponse | null; refactor: JaqlResponse | null }>({
    regular: null,
    refactor: null,
  });

  const [loading, setLoading] = useState({ regular: false, refactor: false });
  const [error, setError] = useState('');
  const [comparison, setComparison] = useState<DataComparisonResult | null>(null);

  const fetchData = async (env: Env) => {
    if (missingContext || !inputs) {
      setError('Missing widget comparison context. Start from Widget Inspector first.');
      return;
    }

    const isRegular = env === 'regular';
    const widgetJson = isRegular ? regularWidget : refactorWidget;
    const config = isRegular
      ? { url: inputs.regUrl, token: inputs.regToken, label: 'LEGACY (OLD)' }
      : { url: inputs.refUrl, token: inputs.refToken, label: 'REFACTOR (NEW)' };

    if (!widgetJson || !config.url || !config.token) {
      setError(`Credentials for ${config.label} are missing. Go back to Step 1.`);
      return;
    }

    setLoading((prev) => ({ ...prev, [env]: true }));
    setError('');

    try {
      const jaqlBody = prepareJaqlBody(widgetJson);
      if (!jaqlBody) {
        throw new Error('Widget metadata is incomplete for JAQL request.');
      }

      const res = await fetch('/api/widget/jaql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: config.url,
          token: config.token,
          datasource: widgetJson.datasource?.fullname,
          jaql: jaqlBody,
        }),
      });

      const json = (await res.json()) as { data?: JaqlResponse; error?: string };
      if (!res.ok || !json.data) throw new Error(json.error || 'Failed to fetch data');

      setResults((prev) => ({ ...prev, [env]: json.data }));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(`${config.label} Error: ${message}`);
    } finally {
      setLoading((prev) => ({ ...prev, [env]: false }));
    }
  };

  const runDataComparison = () => {
    if (!results.regular || !results.refactor) return;

    const regValues = results.regular.values ?? [];
    const refValues = results.refactor.values ?? [];
    const maxLength = Math.max(regValues.length, refValues.length);
    const diffRows: CompareRow[] = [];

    for (let i = 0; i < maxLength; i += 1) {
      const regRow = regValues[i] ?? null;
      const refRow = refValues[i] ?? null;
      const isRowMatch = stableStringify(regRow) === stableStringify(refRow);

      diffRows.push({
        index: i,
        reg: regRow,
        ref: refRow,
        isRowMatch,
      });
    }

    const mismatchCount = diffRows.filter((row) => !row.isRowMatch).length;
    const isMatch = mismatchCount === 0;

    setComparison({
      match: isMatch,
      regCount: regValues.length,
      refCount: refValues.length,
      mismatchCount,
      diffRows,
    });

    updateQaState({
      phase: 'DATA_COMPARE_DONE',
      dataCompareResult: {
        regularRowCount: regValues.length,
        refactorRowCount: refValues.length,
        mismatches: mismatchCount,
      },
    });
  };

  const handleExportCSV = () => {
    if (!comparison) return;

    const headers = ['Row Index', 'Status', 'Legacy Data', 'Refactor Data'].join(',');
    const rows = comparison.diffRows.map((r) =>
      [
        r.index + 1,
        r.isRowMatch ? 'MATCH' : 'MISMATCH',
        `"${JSON.stringify(r.reg).replace(/"/g, '""')}"`,
        `"${JSON.stringify(r.ref).replace(/"/g, '""')}"`,
      ].join(',')
    );

    const blob = new Blob([`${headers}\n${rows.join('\n')}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Data_Audit_Report_${Date.now()}.csv`;
    link.click();
  };

  if (missingContext) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900 p-8">
        <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
          <h1 className="text-2xl font-black text-slate-900 mb-3">Data Audit Context Missing</h1>
          <p className="text-slate-500 mb-6">
            Open Widget Inspector first, fetch both widget payloads, and run comparison before entering Data Audit.
          </p>
          <button
            onClick={() => router.push('/widget')}
            className="bg-slate-900 text-white px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2"
          >
            <ArrowLeft size={16} /> Go to Widget Inspector
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-20 font-sans">
      <div className="bg-white border-b px-8 py-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="bg-blue-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Phase 2</span>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight italic">Data Audit</h1>
            </div>
            <p className="text-slate-500 text-sm font-medium">Compare Legacy vs Refactor output data using the validated widget metadata request.</p>
          </div>
          <button
            onClick={() => router.push('/widget')}
            className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest"
          >
            Back to Widget
          </button>
        </div>
      </div>

      <main className="max-w-7xl mx-auto p-8 space-y-10">
        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-6 flex items-center gap-2 italic">
            <Layers size={14} /> Connection Context
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <ContextDetail label="Legacy Environment (OLD)" url={inputs?.regUrl} ds={regularWidget?.datasource?.fullname} />
            <ContextDetail label="Refactor Environment (NEW)" url={inputs?.refUrl} ds={refactorWidget?.datasource?.fullname} />
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {(['regular', 'refactor'] as const).map((env) => (
            <button
              key={env}
              onClick={() => fetchData(env)}
              disabled={loading[env]}
              className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg ${env === 'regular' ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-100' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-100'} text-white disabled:opacity-50`}
            >
              {loading[env] ? <Activity className="animate-spin" /> : <RefreshCcw size={16} />}
              Fetch {env === 'regular' ? 'Legacy' : 'Refactor'} Data
            </button>
          ))}
        </div>

        {!comparison && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {(['regular', 'refactor'] as const).map((env) => (
              <div key={env} className="bg-[#0F172A] rounded-[2.5rem] h-[300px] overflow-hidden shadow-2xl flex flex-col border border-slate-800">
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase italic flex items-center gap-2">
                    <FileJson size={14} className="text-blue-400" /> {env}_payload.json
                  </span>
                </div>
                <pre className="p-6 text-[11px] text-emerald-400 font-mono overflow-auto flex-1 custom-scrollbar">
                  {results[env] ? JSON.stringify(results[env]?.values, null, 2) : '// Data not yet loaded...'}
                </pre>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col items-center py-6 border-y border-slate-200">
          <button
            onClick={runDataComparison}
            disabled={!results.regular || !results.refactor}
            className="group bg-blue-600 text-white px-16 py-6 rounded-[2.5rem] font-black text-xl shadow-2xl shadow-blue-200 hover:-translate-y-1 transition-all disabled:bg-slate-300 flex items-center gap-4"
          >
            <Zap fill="currentColor" /> RUN DATA COMPARISON
          </button>
        </div>

        {comparison && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-10 duration-700">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <StatBox label="Legacy Rows" val={comparison.regCount} />
              <StatBox label="Refactor Rows" val={comparison.refCount} />
              <StatBox label="Mismatches" val={comparison.mismatchCount} color={comparison.mismatchCount ? 'text-rose-500' : 'text-emerald-500'} />
              <StatBox label="Audit Result" val={comparison.match ? 'PASSED' : 'FAILED'} color={comparison.match ? 'text-emerald-500' : 'text-rose-500'} />
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
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}

function ContextDetail({ label, url, ds }: { label: string; url?: string; ds?: string }) {
  return (
    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
      <h4 className="font-black text-slate-800 text-[10px] uppercase mb-2 tracking-widest">{label}</h4>
      <p className="text-[11px] font-mono text-slate-500 truncate mb-1">Base: {url || 'N/A'}</p>
      <p className="text-[11px] font-mono text-blue-600 truncate font-bold">Datasource: {ds || 'N/A'}</p>
    </div>
  );
}

function StatBox({ label, val, color = 'text-slate-900' }: { label: string; val: string | number; color?: string }) {
  return (
    <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center shadow-sm">
      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3 italic">{label}</p>
      <p className={`text-4xl font-black tracking-tighter ${color}`}>{val}</p>
    </div>
  );
}
