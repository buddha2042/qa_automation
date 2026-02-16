'use client';

import { useState } from 'react';
import AppHeader from '@/components/AppHeader';

type Environment = 'regular' | 'refactor';

interface DashboardResult {
  dashboardId: string;
  title: string;
  widgets: string[];
}

interface ConfigState {
  regular: { url: string; token: string };
  refactor: { url: string; token: string };
}

interface SisenseDashboard {
  _id: string;
  title: string;
  layout?: {
    columns?: Array<{
      cells?: Array<{
        subcells?: Array<{
          elements?: Array<{ widgetid?: string }>;
        }>;
      }>;
    }>;
  };
}

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export default function QaCapturePage() {
  const [config, setConfig] = useState<ConfigState>({
    regular: { url: '', token: '' },
    refactor: { url: '', token: '' },
  });

  const [results, setResults] = useState<Record<Environment, DashboardResult[]>>({
    regular: [],
    refactor: [],
  });

  const [loading, setLoading] = useState<Record<Environment, boolean>>({
    regular: false,
    refactor: false,
  });
  const [error, setError] = useState('');

  const extractWidgetIds = (layout?: SisenseDashboard['layout']): string[] => {
    const ids: string[] = [];
    if (!layout?.columns) return ids;

    layout.columns.forEach((col) => {
      col.cells?.forEach((cell) => {
        cell.subcells?.forEach((sub) => {
          sub.elements?.forEach((el) => {
            if (el.widgetid) ids.push(el.widgetid);
          });
        });
      });
    });

    return ids;
  };

  const downloadAsCsv = () => {
    if (results.regular.length === 0 && results.refactor.length === 0) return;

    let csvContent = 'Environment,Dashboard Title,Dashboard ID,Widget ID\n';

    (['regular', 'refactor'] as const).forEach((env) => {
      results[env].forEach((dash) => {
        dash.widgets.forEach((wId) => {
          const title = `"${dash.title.replace(/"/g, '""')}"`;
          csvContent += `${env.toUpperCase()},${title},${dash.dashboardId},${wId}\n`;
        });
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `sisense_inventory_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchInventory = async (env: Environment) => {
    const { url, token } = config[env];
    const trimmedUrl = url.trim();
    const trimmedToken = token.trim();

    if (!trimmedUrl || !trimmedToken) {
      setError(`Please provide both URL and Token for ${env}`);
      return;
    }

    if (!isValidHttpUrl(trimmedUrl)) {
      setError(`Invalid URL for ${env}. Use a full http(s) URL.`);
      return;
    }

    setLoading((prev) => ({ ...prev, [env]: true }));
    setError('');

    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: trimmedUrl, token: trimmedToken }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch inventory');

      const list = Array.isArray(json.data) ? (json.data as SisenseDashboard[]) : [];
      const formatted: DashboardResult[] = list.map((dash) => ({
        dashboardId: dash._id,
        title: dash.title,
        widgets: extractWidgetIds(dash.layout),
      }));

      setResults((prev) => ({ ...prev, [env]: formatted }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading((prev) => ({ ...prev, [env]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader title="DXC Quality Lab" subtitle="Master Informer" backHref="/" />
      <div className="max-w-7xl mx-auto p-8">
        <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Sisense Widget Inventory</h1>
            <p className="text-slate-500 mt-2">Map and export Dashboard IDs with Widget IDs</p>
          </div>
          <div className="flex gap-3">
            {(results.regular.length > 0 || results.refactor.length > 0) && (
              <button
                onClick={downloadAsCsv}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-900/20"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clipRule="evenodd" /></svg>
                Export CSV
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="mb-6 bg-rose-50 border border-rose-200 p-4 rounded text-rose-700 text-sm flex items-center gap-2">
            <span>⚠️</span> {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {(['regular', 'refactor'] as Environment[]).map((env) => (
            <div key={env} className="flex flex-col">
              <div className={`p-6 rounded-t-xl border-t-2 border-x border-slate-200 bg-white ${env === 'regular' ? 'border-t-green-500' : 'border-t-yellow-500'}`}>
                <h2 className="text-lg font-bold capitalize mb-4 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${env === 'regular' ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                  {env} Environment
                </h2>

                <div className="space-y-4">
                  <input
                    placeholder="Base URL (e.g. https://instance.sisense.com)"
                    value={config[env].url}
                    onChange={(e) => setConfig({ ...config, [env]: { ...config[env], url: e.target.value } })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none transition-all placeholder:text-slate-400"
                  />
                  <input
                    type="password"
                    placeholder="API Token (JWT)"
                    value={config[env].token}
                    onChange={(e) => setConfig({ ...config, [env]: { ...config[env], token: e.target.value } })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none transition-all placeholder:text-slate-400"
                  />
                  <button
                    onClick={() => fetchInventory(env)}
                    disabled={loading[env]}
                    className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all ${env === 'regular' ? 'bg-green-600 hover:bg-green-500 shadow-green-900/20' : 'bg-yellow-600 hover:bg-yellow-500 text-black shadow-yellow-900/20'} disabled:opacity-50 shadow-lg`}
                  >
                    {loading[env] ? 'Processing Sisense...' : 'Fetch Dashboards & Widgets'}
                  </button>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-b-xl p-4 h-[650px] overflow-auto custom-scrollbar">
                {results[env].length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 italic text-sm space-y-2">
                    <svg className="w-8 h-8 opacity-10" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" /></svg>
                    <p>No inventory loaded.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {results[env].map((dash) => (
                      <div key={`${dash.dashboardId}-${env}`} className="bg-slate-50 rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors shadow-sm">
                        <div className="mb-4">
                          <h3 className="text-sm font-bold text-slate-900 mb-2 line-clamp-1" title={dash.title}>
                            {dash.title}
                          </h3>

                          <div className="flex items-center gap-2 group/dash">
                            <div className="flex items-center bg-white border border-slate-300 rounded-md overflow-hidden shadow-inner">
                              <span className="px-1.5 py-0.5 bg-slate-100 text-[8px] font-black text-slate-500 uppercase tracking-tighter border-r border-slate-300">
                                DASH ID
                              </span>
                              <code className="px-2 py-0.5 text-[10px] text-blue-400 font-mono tracking-tighter">
                                {dash.dashboardId}
                              </code>
                            </div>
                            <button
                              onClick={() => navigator.clipboard.writeText(dash.dashboardId)}
                              className="p-1 hover:bg-slate-200 rounded transition-colors"
                              title="Copy Dashboard ID"
                            >
                              <svg className="w-3 h-3 text-slate-500 hover:text-slate-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5 pl-2 border-l-2 border-slate-200">
                          <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-2 flex justify-between">
                            <span>Widgets ({dash.widgets.length})</span>
                          </div>
                          {dash.widgets.map((wId) => (
                            <div key={wId} className="flex items-center justify-between text-[11px] bg-white hover:bg-slate-50 p-2 rounded-lg group transition-colors border border-slate-200">
                              <span className="text-slate-600 font-mono">{wId}</span>
                              <button
                                onClick={() => navigator.clipboard.writeText(wId)}
                                className="opacity-0 group-hover:opacity-100 text-[9px] font-bold text-blue-400 hover:text-blue-300 transition-all uppercase tracking-tighter"
                              >
                                Copy
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
}
