'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { useQa } from '@/context/QaContext';
import { CheckCircle2, XCircle, Link2 } from 'lucide-react';

type Environment = 'regular' | 'refactor';

interface EnvConfig {
  url: string;
  token: string;
}

interface ConfigState {
  regular: EnvConfig;
  refactor: EnvConfig;
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

interface DashboardItem {
  dashboardId: string;
  title: string;
  widgets: string[];
}

interface MatchedDashboard {
  regularDashboardId: string;
  refactorDashboardId: string;
  regularTitle: string;
  refactorTitle: string;
  regularWidgets: string[];
  refactorWidgets: string[];
  matchedWidgets: string[];
  matchBasis: 'dashboard_id' | 'dashboard_title';
}

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

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

const normalizeTitle = (title: string): string =>
  title.trim().toLowerCase().replace(/\s+/g, ' ');

const getWidgetDisplayTitle = (widgetId: string): string =>
  `Widget ${widgetId.slice(0, 8)}${widgetId.length > 8 ? '...' : ''}`;

export default function DashboardInspectorPage() {
  const router = useRouter();
  const { setQaState } = useQa();

  const [config, setConfig] = useState<ConfigState>({
    regular: { url: '', token: '' },
    refactor: { url: '', token: '' },
  });

  const [inventories, setInventories] = useState<Record<Environment, DashboardItem[]>>({
    regular: [],
    refactor: [],
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canRun =
    isValidHttpUrl(config.regular.url.trim()) &&
    isValidHttpUrl(config.refactor.url.trim()) &&
    config.regular.token.trim().length > 20 &&
    config.refactor.token.trim().length > 20;

  const matchedDashboards = useMemo<MatchedDashboard[]>(() => {
    const results: MatchedDashboard[] = [];
    const usedRegularIds = new Set<string>();
    const usedRefactorIds = new Set<string>();

    const regularById = new Map(inventories.regular.map((d) => [d.dashboardId, d]));
    const regularByTitle = new Map<string, DashboardItem[]>();
    for (const dash of inventories.regular) {
      const key = normalizeTitle(dash.title);
      const bucket = regularByTitle.get(key) ?? [];
      bucket.push(dash);
      regularByTitle.set(key, bucket);
    }

    const addMatch = (
      reg: DashboardItem,
      ref: DashboardItem,
      matchBasis: 'dashboard_id' | 'dashboard_title'
    ) => {
      const refWidgetSet = new Set(ref.widgets);
      const matchedWidgets = reg.widgets.filter((wid) => refWidgetSet.has(wid));

      usedRegularIds.add(reg.dashboardId);
      usedRefactorIds.add(ref.dashboardId);
      results.push({
        regularDashboardId: reg.dashboardId,
        refactorDashboardId: ref.dashboardId,
        regularTitle: reg.title,
        refactorTitle: ref.title,
        regularWidgets: reg.widgets,
        refactorWidgets: ref.widgets,
        matchedWidgets,
        matchBasis,
      });
    };

    // Pass 1: exact dashboard ID matches.
    for (const ref of inventories.refactor) {
      const reg = regularById.get(ref.dashboardId);
      if (!reg) continue;
      addMatch(reg, ref, 'dashboard_id');
    }

    // Pass 2: title matches for dashboards not matched by ID.
    for (const ref of inventories.refactor) {
      if (usedRefactorIds.has(ref.dashboardId)) continue;

      const key = normalizeTitle(ref.title);
      const candidates = regularByTitle.get(key) ?? [];
      const reg = candidates.find((item) => !usedRegularIds.has(item.dashboardId));
      if (!reg) continue;

      addMatch(reg, ref, 'dashboard_title');
    }

    return results.sort((a, b) => b.matchedWidgets.length - a.matchedWidgets.length);
  }, [inventories]);

  const summary = useMemo(() => {
    const matchedDashboardCount = matchedDashboards.length;
    const totalMatchedWidgets = matchedDashboards.reduce(
      (sum, dash) => sum + dash.matchedWidgets.length,
      0
    );

    return {
      regularDashboards: inventories.regular.length,
      refactorDashboards: inventories.refactor.length,
      matchedDashboardCount,
      totalMatchedWidgets,
    };
  }, [inventories, matchedDashboards]);

  const fetchEnvDashboards = async (env: Environment): Promise<DashboardItem[]> => {
    const { url, token } = config[env];

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: url.trim(),
        token: token.trim(),
      }),
    });

    const json = (await res.json()) as { data?: unknown; error?: string };
    if (!res.ok) throw new Error(json.error || `Failed to fetch ${env} dashboards`);

    const dashboards = Array.isArray(json.data) ? (json.data as SisenseDashboard[]) : [];

    return dashboards.map((dash) => ({
      dashboardId: dash._id,
      title: dash.title,
      widgets: extractWidgetIds(dash.layout),
    }));
  };

  const runDashboardInspect = async () => {
    if (!canRun) {
      setError('Please enter valid URLs and tokens for both environments.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [regular, refactor] = await Promise.all([
        fetchEnvDashboards('regular'),
        fetchEnvDashboards('refactor'),
      ]);

      setInventories({ regular, refactor });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const inspectWidget = (
    regularDashboardId: string,
    refactorDashboardId: string,
    widgetId: string
  ) => {
    setQaState((prev) => ({
      ...prev,
      inputs: {
        regUrl: config.regular.url.trim(),
        regToken: config.regular.token.trim(),
        refUrl: config.refactor.url.trim(),
        refToken: config.refactor.token.trim(),
        regDashId: regularDashboardId,
        refDashId: refactorDashboardId,
        regWidgetId: widgetId,
        refWidgetId: widgetId,
      },
      phase: 'WIDGET_QA_RUNNING',
      createdAt: new Date().toISOString(),
    }));

    router.push('/widget');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-20 font-sans">
      <AppHeader title="DXC Quality Lab" subtitle="Dashboard Inspector" backHref="/" />

      <main className="max-w-7xl mx-auto p-8 space-y-8">
        <section className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800">
            Dashboard Inspector
          </h1>
          <p className="text-sm text-slate-500 mt-2 max-w-3xl">
            Fetch dashboard inventories from both environments, auto-match by Dashboard ID,
            auto-match widgets, then click a matched widget to open Widget Inspector with inputs prefilled.
          </p>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {(['regular', 'refactor'] as const).map((env) => {
            const isRegular = env === 'regular';

            return (
              <div key={env} className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-sm space-y-4">
                <h2 className={`text-xs font-black uppercase tracking-widest ${isRegular ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {isRegular ? 'Source: Legacy (Old)' : 'Target: Refactor (New)'}
                </h2>

                <input
                  placeholder="API Base URL"
                  value={config[env].url}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      [env]: { ...prev[env], url: e.target.value },
                    }))
                  }
                  className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />

                <input
                  type="password"
                  placeholder="Bearer Token"
                  value={config[env].token}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      [env]: { ...prev[env], token: e.target.value },
                    }))
                  }
                  className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
            );
          })}
        </section>

        <section className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
          <button
            onClick={runDashboardInspect}
            disabled={!canRun || loading}
            className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg ${
              !canRun || loading
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-blue-200'
            }`}
          >
            {loading ? 'Fetching and Matching Dashboards...' : 'Run Dashboard Inspect'}
          </button>

          {error && (
            <p className="mt-4 text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2 text-sm font-semibold">
              {error}
            </p>
          )}
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Legacy Dashboards" value={summary.regularDashboards} tone="slate" />
          <SummaryCard label="Refactor Dashboards" value={summary.refactorDashboards} tone="slate" />
          <SummaryCard label="Matched Dashboards" value={summary.matchedDashboardCount} tone="blue" />
          <SummaryCard label="Matched Widgets" value={summary.totalMatchedWidgets} tone="emerald" />
        </section>

        <section className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">
              Matched Dashboards and Widgets
            </h3>
            <span className="text-xs text-slate-500">
              Click any matched widget to inspect it in Widget Inspector.
            </span>
          </div>

          {matchedDashboards.length === 0 ? (
            <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl p-5 bg-slate-50">
              No matched dashboards yet. Run Dashboard Inspect after entering both environment credentials.
            </div>
          ) : (
            <div className="space-y-4">
              {matchedDashboards.map((dash) => (
                <div
                  key={`${dash.regularDashboardId}-${dash.refactorDashboardId}`}
                  className="border border-slate-200 rounded-2xl p-4 bg-slate-50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-black mb-1">
                          Legacy Dashboard
                        </div>
                        <div className="text-[11px] text-slate-700 font-semibold">{dash.regularTitle}</div>
                        <code className="text-[11px] font-mono text-blue-700">{dash.regularDashboardId}</code>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-black mb-1">
                          Refactor Dashboard
                        </div>
                        <div className="text-[11px] text-slate-700 font-semibold">{dash.refactorTitle}</div>
                        <code className="text-[11px] font-mono text-blue-700">{dash.refactorDashboardId}</code>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {dash.matchedWidgets.length > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 size={12} /> MATCHED WIDGETS: {dash.matchedWidgets.length}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-100 text-rose-700 border border-rose-200">
                          <XCircle size={12} /> NO WIDGET MATCH
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 border border-slate-200">
                        {dash.matchBasis === 'dashboard_id' ? 'MATCHED BY ID' : 'MATCHED BY TITLE'}
                      </span>
                    </div>
                  </div>

                  {dash.matchedWidgets.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {dash.matchedWidgets.map((widgetId) => (
                        <div
                          key={`${dash.regularDashboardId}-${dash.refactorDashboardId}-${widgetId}`}
                          className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                              {getWidgetDisplayTitle(widgetId)}
                            </div>
                            <code className="text-[11px] font-mono text-slate-700 break-all">{widgetId}</code>
                          </div>
                          <button
                            onClick={() =>
                              inspectWidget(dash.regularDashboardId, dash.refactorDashboardId, widgetId)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-blue-600 transition-all shrink-0"
                          >
                            <Link2 size={12} /> Inspect
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'blue' | 'emerald';
}) {
  const toneClass =
    tone === 'blue'
      ? 'text-blue-600'
      : tone === 'emerald'
        ? 'text-emerald-600'
        : 'text-slate-700';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{label}</div>
      <div className={`text-3xl font-black ${toneClass}`}>{value}</div>
    </div>
  );
}
