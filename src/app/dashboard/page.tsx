'use client';

import { useMemo, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import { useQa } from '@/context/QaContext';
import { CheckCircle2, Link2, Download, ChevronDown, ChevronRight } from 'lucide-react';

type Environment = 'regular' | 'refactor';
type MatchBasis = 'dashboard_id' | 'dashboard_title';
type WidgetRunStatus = 'NOT_RUN' | 'RUNNING' | 'MATCH' | 'MISMATCH' | 'ERROR';

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
          elements?: Array<{
            widgetid?: string;
            title?: string;
            name?: string;
          }>;
        }>;
      }>;
    }>;
  };
}

interface DashboardItem {
  dashboardId: string;
  title: string;
  widgets: string[];
  widgetTitles: Record<string, string>;
}

interface MatchedDashboard {
  regularDashboardId: string;
  refactorDashboardId: string;
  regularTitle: string;
  refactorTitle: string;
  matchedWidgets: string[];
  regularWidgetTitles: Record<string, string>;
  refactorWidgetTitles: Record<string, string>;
  matchBasis: MatchBasis;
}

interface WidgetCompareResult {
  key: string;
  regularDashboardId: string;
  refactorDashboardId: string;
  widgetId: string;
  status: Exclude<WidgetRunStatus, 'NOT_RUN' | 'RUNNING'>;
  diffCount: number;
  reason?: string;
  comparisons?: Array<{
    path: string;
    status: 'MATCH' | 'MISMATCH';
    regularValue: string;
    refactorValue: string;
  }>;
  outputCompare?: {
    legacyHeaders: string[];
    refactorHeaders: string[];
    legacyRows: string[][];
    refactorRows: string[][];
    rows: Array<{
      status: 'MATCH' | 'MISMATCH';
      legacyRowKey: string;
      refactorRowKey: string;
      legacyValues: string[];
      refactorValues: string[];
    }>;
    mismatchRowCount: number;
  };
}

interface WidgetInspectPrefill {
  regUrl: string;
  regToken: string;
  refUrl: string;
  refToken: string;
  regDashId: string;
  refDashId: string;
  regWidgetId: string;
  refWidgetId: string;
  createdAt: string;
}

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeTitle = (title: string): string =>
  title.trim().toLowerCase().replace(/\s+/g, ' ');

const extractWidgetMeta = (layout?: SisenseDashboard['layout']) => {
  const ids = new Set<string>();
  const titles: Record<string, string> = {};
  if (!layout?.columns) return { ids: [], titles };

  layout.columns.forEach((col) => {
    col.cells?.forEach((cell) => {
      cell.subcells?.forEach((sub) => {
        sub.elements?.forEach((el) => {
          if (!el.widgetid) return;
          ids.add(el.widgetid);
          const candidateTitle = typeof el.title === 'string' ? el.title : el.name;
          if (typeof candidateTitle === 'string' && candidateTitle.trim()) {
            titles[el.widgetid] = candidateTitle.trim();
          }
        });
      });
    });
  });

  return {
    ids: Array.from(ids),
    titles,
  };
};

const widgetKey = (regularDashboardId: string, refactorDashboardId: string, widgetId: string): string =>
  `${regularDashboardId}::${refactorDashboardId}::${widgetId}`;

const toCsv = (rows: string[][]): string =>
  rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

export default function DashboardInspectorPage() {
  const { setQaState } = useQa();

  const [config, setConfig] = useState<ConfigState>({
    regular: { url: '', token: '' },
    refactor: { url: '', token: '' },
  });

  const [inventories, setInventories] = useState<Record<Environment, DashboardItem[]>>({
    regular: [],
    refactor: [],
  });

  const [compareResults, setCompareResults] = useState<Record<string, WidgetCompareResult>>({});
  const [runningWidgets, setRunningWidgets] = useState<Record<string, boolean>>({});
  const [expandedDashboards, setExpandedDashboards] = useState<Record<string, boolean>>({});

  const [loadingMatches, setLoadingMatches] = useState(false);
  const [error, setError] = useState('');

  const canFetchMatches =
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
      regularDash: DashboardItem,
      refactorDash: DashboardItem,
      matchBasis: MatchBasis
    ) => {
      const refWidgetSet = new Set(refactorDash.widgets);
      const matchedWidgets = regularDash.widgets.filter((id) => refWidgetSet.has(id));

      usedRegularIds.add(regularDash.dashboardId);
      usedRefactorIds.add(refactorDash.dashboardId);

      results.push({
        regularDashboardId: regularDash.dashboardId,
        refactorDashboardId: refactorDash.dashboardId,
        regularTitle: regularDash.title,
        refactorTitle: refactorDash.title,
        matchedWidgets,
        regularWidgetTitles: regularDash.widgetTitles,
        refactorWidgetTitles: refactorDash.widgetTitles,
        matchBasis,
      });
    };

    for (const refDash of inventories.refactor) {
      const regDash = regularById.get(refDash.dashboardId);
      if (!regDash) continue;
      addMatch(regDash, refDash, 'dashboard_id');
    }

    for (const refDash of inventories.refactor) {
      if (usedRefactorIds.has(refDash.dashboardId)) continue;
      const candidates = regularByTitle.get(normalizeTitle(refDash.title)) ?? [];
      const regDash = candidates.find((d) => !usedRegularIds.has(d.dashboardId));
      if (!regDash) continue;
      addMatch(regDash, refDash, 'dashboard_title');
    }

    return results.sort((a, b) => b.matchedWidgets.length - a.matchedWidgets.length);
  }, [inventories]);

  const summary = useMemo(() => {
    const compared = Object.keys(compareResults).length;
    const matched = Object.values(compareResults).filter((r) => r.status === 'MATCH').length;
    const mismatched = Object.values(compareResults).filter((r) => r.status === 'MISMATCH').length;
    const errors = Object.values(compareResults).filter((r) => r.status === 'ERROR').length;

    return {
      regularDashboards: inventories.regular.length,
      refactorDashboards: inventories.refactor.length,
      matchedDashboards: matchedDashboards.length,
      matchedWidgets: matchedDashboards.reduce((sum, dash) => sum + dash.matchedWidgets.length, 0),
      compared,
      matched,
      mismatched,
      errors,
    };
  }, [inventories, matchedDashboards, compareResults]);

  const fetchEnvDashboards = async (env: Environment): Promise<DashboardItem[]> => {
    const { url, token } = config[env];

    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: url.trim(), token: token.trim() }),
    });

    const json = (await response.json()) as { data?: unknown; error?: string };
    if (!response.ok) throw new Error(json.error || `Failed to fetch ${env} dashboards`);

    const dashboards = Array.isArray(json.data) ? (json.data as SisenseDashboard[]) : [];

    return dashboards.map((dash) => {
      const widgetMeta = extractWidgetMeta(dash.layout);
      return {
        dashboardId: dash._id,
        title: dash.title,
        widgets: widgetMeta.ids,
        widgetTitles: widgetMeta.titles,
      };
    });
  };

  const fetchMatches = async () => {
    if (!canFetchMatches) {
      setError('Please enter valid URLs and tokens for both environments.');
      return;
    }

    setLoadingMatches(true);
    setError('');

    try {
      const [regular, refactor] = await Promise.all([
        fetchEnvDashboards('regular'),
        fetchEnvDashboards('refactor'),
      ]);

      setInventories({ regular, refactor });
      setCompareResults({});
      setRunningWidgets({});
      setExpandedDashboards({});
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoadingMatches(false);
    }
  };

  const compareSingleWidget = async (
    regularDashboardId: string,
    refactorDashboardId: string,
    widgetId: string
  ) => {
    if (!canFetchMatches) {
      setError('Please enter valid URLs and tokens for both environments.');
      return;
    }

    const key = widgetKey(regularDashboardId, refactorDashboardId, widgetId);
    if (runningWidgets[key]) {
      return;
    }

    setError('');
    setRunningWidgets((prev) => ({ ...prev, [key]: true }));

    try {
      const response = await fetch('/api/dashboard/compare/widget-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regular: {
            url: config.regular.url.trim(),
            token: config.regular.token.trim(),
          },
          refactor: {
            url: config.refactor.url.trim(),
            token: config.refactor.token.trim(),
          },
          selections: [{ key, regularDashboardId, refactorDashboardId, widgetId }],
        }),
      });

      const json = (await response.json()) as {
        data?: WidgetCompareResult[];
        error?: string;
      };

      if (!response.ok || !json.data) {
        throw new Error(json.error || 'Failed to compare widget');
      }

      const [item] = json.data as WidgetCompareResult[];
      if (item) {
        setCompareResults((prev) => ({ ...prev, [item.key]: item }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setRunningWidgets((prev) => ({ ...prev, [key]: false }));
    }
  };

  const exportComparedCsv = () => {
    const rows = Object.values(compareResults);
    if (rows.length === 0) {
      setError('No compared widgets available to export yet.');
      return;
    }

    const lines: string[][] = [
      [
        'Regular Dashboard ID',
        'Refactor Dashboard ID',
        'Widget ID',
        'Status',
        'Diff Count',
        'Reason',
      ],
      ...rows.map((r) => [
        r.regularDashboardId,
        r.refactorDashboardId,
        r.widgetId,
        r.status,
        String(r.diffCount),
        r.reason ?? '',
      ]),
    ];

    const csv = toCsv(lines);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `dashboard_widget_compare_${Date.now()}.csv`;
    link.click();
  };

  const exportWidgetProofCsv = (result: WidgetCompareResult) => {
    const outputCompare = result.outputCompare;
    let csv = '';

    if (
      outputCompare &&
      (outputCompare.rows.length > 0 ||
        outputCompare.legacyRows.length > 0 ||
        outputCompare.refactorRows.length > 0)
    ) {
      const headers = [
        'Status',
        'Legacy Row Key',
        'Refactor Row Key',
        ...outputCompare.legacyHeaders.map((h) => `Legacy - ${h}`),
        ...outputCompare.refactorHeaders.map((h) => `Refactor - ${h}`),
      ];

      const rows = outputCompare.rows.map((row) => {
        const legacyCells = outputCompare.legacyHeaders.map((_, i) => row.legacyValues[i] ?? '');
        const refCells = outputCompare.refactorHeaders.map((_, i) => row.refactorValues[i] ?? '');
        return [
          row.status,
          row.legacyRowKey,
          row.refactorRowKey,
          ...legacyCells,
          ...refCells,
        ];
      });

      csv = toCsv([headers, ...rows]);
    } else {
      csv = toCsv([
        [
          'Regular Dashboard ID',
          'Refactor Dashboard ID',
          'Widget ID',
          'Status',
          'Reason',
        ],
        [
          result.regularDashboardId,
          result.refactorDashboardId,
          result.widgetId,
          result.status,
          result.reason ?? 'Output data unavailable for this widget.',
        ],
      ]);
    }

    const safeWidgetId = result.widgetId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `widget_proof_${safeWidgetId}_${Date.now()}.csv`;
    link.click();
  };

  const inspectWidget = (result: WidgetCompareResult) => {
    const payload: WidgetInspectPrefill = {
      regUrl: config.regular.url.trim(),
      regToken: config.regular.token.trim(),
      refUrl: config.refactor.url.trim(),
      refToken: config.refactor.token.trim(),
      regDashId: result.regularDashboardId,
      refDashId: result.refactorDashboardId,
      regWidgetId: result.widgetId,
      refWidgetId: result.widgetId,
      createdAt: new Date().toISOString(),
    };

    const prefillKey = `widget_inspect_prefill_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(prefillKey, JSON.stringify(payload));

    setQaState((prev) => ({
      ...prev,
      inputs: {
        regUrl: payload.regUrl,
        regToken: payload.regToken,
        refUrl: payload.refUrl,
        refToken: payload.refToken,
        regDashId: payload.regDashId,
        refDashId: payload.refDashId,
        regWidgetId: payload.regWidgetId,
        refWidgetId: payload.refWidgetId,
      },
      phase: 'WIDGET_QA_RUNNING',
      createdAt: payload.createdAt,
    }));

    const opened = window.open(`/widget?prefillKey=${encodeURIComponent(prefillKey)}`, '_blank');
    if (opened) {
      opened.opener = null;
    } else {
      setError('Popup blocked. Please allow popups for this site to open Widget Inspector in a new tab.');
    }
  };

  const getWidgetStatus = (key: string): WidgetRunStatus => {
    if (runningWidgets[key]) return 'RUNNING';
    if (compareResults[key]) return compareResults[key].status;
    return 'NOT_RUN';
  };

  const toggleDashboardExpanded = (dashboardKey: string) => {
    setExpandedDashboards((prev) => ({ ...prev, [dashboardKey]: !prev[dashboardKey] }));
  };

  const getWidgetStatusLabel = (status: WidgetRunStatus): string => {
    if (status === 'NOT_RUN') return 'READY';
    if (status === 'RUNNING') return 'RUNNING';
    if (status === 'MISMATCH') return 'MISMATCH';
    if (status === 'ERROR') return 'ERROR';
    return 'MATCH';
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
            Fetch both dashboard inventories, compare all common widgets, run full quality assurance checks, and export proof data to CSV.
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

        <section className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm space-y-4">
          <button
            onClick={fetchMatches}
            disabled={!canFetchMatches || loadingMatches}
            className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg ${
              !canFetchMatches || loadingMatches
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-blue-200'
            }`}
          >
            {loadingMatches ? 'Fetching Dashboard Inventory...' : 'Fetch Dashboard Inventory'}
          </button>

          {error && (
            <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2 text-sm font-semibold">
              {error}
            </p>
          )}
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <SummaryCard label="Common Dashboards" value={summary.matchedDashboards} tone="blue" />
          <SummaryCard label="Common Widgets" value={summary.matchedWidgets} tone="slate" />
          <SummaryCard label="Compared" value={summary.compared} tone="slate" />
          <SummaryCard label="Matches" value={summary.matched} tone="emerald" />
          <SummaryCard label="Mismatches" value={summary.mismatched + summary.errors} tone="rose" />
        </section>

        <section className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm h-[70vh] flex flex-col">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">
                Common Dashboards and Common Widgets
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Run compare directly on each common widget.
              </p>
            </div>
            <button
              onClick={exportComparedCsv}
              disabled={Object.keys(compareResults).length === 0}
              className={`px-3 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
                Object.keys(compareResults).length === 0
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-slate-900 text-white hover:bg-blue-600'
              }`}
            >
              <Download size={12} /> Export Compared CSV
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
            {matchedDashboards.length === 0 ? (
              <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl p-5 bg-slate-50">
                No common dashboards yet. Fetch inventory after entering both environment credentials.
              </div>
            ) : (
              <div className="space-y-4">
                {matchedDashboards.map((dash) => {
                  const dashboardKey = `${dash.regularDashboardId}-${dash.refactorDashboardId}`;
                  const isExpanded = Boolean(expandedDashboards[dashboardKey]);

                  return (
                    <div
                      key={dashboardKey}
                      className="border border-slate-200 rounded-2xl p-4 bg-white"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className="text-[20px] leading-tight text-blue-600 font-black mb-1 truncate">
                            {dash.regularTitle === dash.refactorTitle
                              ? dash.regularTitle
                              : `${dash.regularTitle} / ${dash.refactorTitle}`}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 size={12} /> COMMON WIDGETS: {dash.matchedWidgets.length}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 border border-slate-200">
                              Match Basis: {dash.matchBasis === 'dashboard_id' ? 'ID' : 'TITLE'}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => toggleDashboardExpanded(dashboardKey)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                        >
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </button>
                      </div>

                      {isExpanded ? (
                        <>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-3">
                            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-black mt-1">
                              Dashboard ID
                            </div>

                            {dash.regularDashboardId === dash.refactorDashboardId ? (
                              <code className="text-[11px] font-mono text-slate-600 break-all">
                                {dash.regularDashboardId}
                              </code>
                            ) : (
                              <div className="mt-1 space-y-1">
                                <div className="text-[11px] text-slate-600">
                                  <span className="font-semibold">Regular:</span>{' '}
                                  <code className="font-mono break-all">{dash.regularDashboardId}</code>
                                </div>
                                <div className="text-[11px] text-slate-600">
                                  <span className="font-semibold">Refactor:</span>{' '}
                                  <code className="font-mono break-all">{dash.refactorDashboardId}</code>
                                </div>
                              </div>
                            )}
                          </div>

                          {dash.matchedWidgets.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {dash.matchedWidgets.map((widgetId) => {
                                const key = widgetKey(
                                  dash.regularDashboardId,
                                  dash.refactorDashboardId,
                                  widgetId
                                );
                                const widgetTitle =
                                  dash.regularWidgetTitles[widgetId] ??
                                  dash.refactorWidgetTitles[widgetId];
                                const status = getWidgetStatus(key);
                                const result = compareResults[key];
                                const canInspect = Boolean(result);

                                return (
                                  <div
                                    key={key}
                                    className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3"
                                  >
                                    <div className="min-w-0 space-y-1">
                                      {widgetTitle ? (
                                        <>
                                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                            Widget Title
                                          </div>
                                          <div className="text-[12px] font-semibold text-slate-800 truncate">
                                            {widgetTitle}
                                          </div>
                                        </>
                                      ) : null}
                                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 pt-1">
                                        Widget ID
                                      </div>
                                      <code className="text-[11px] font-mono text-slate-700 break-all">{widgetId}</code>
                                      {result?.reason ? (
                                        <p className="text-[10px] text-rose-600 mt-1 line-clamp-2">{result.reason}</p>
                                      ) : null}
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      {status !== 'NOT_RUN' ? (
                                        <span
                                          className={`px-2 py-1 rounded-full text-[10px] font-black border ${
                                            status === 'MATCH'
                                              ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                              : status === 'MISMATCH'
                                                ? 'bg-rose-100 text-rose-700 border-rose-200'
                                                : status === 'ERROR'
                                                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                                                  : 'bg-blue-100 text-blue-700 border-blue-200'
                                          }`}
                                        >
                                          {getWidgetStatusLabel(status)}
                                        </span>
                                      ) : null}

                                      <button
                                        onClick={() =>
                                          compareSingleWidget(
                                            dash.regularDashboardId,
                                            dash.refactorDashboardId,
                                            widgetId
                                          )
                                        }
                                        disabled={status === 'RUNNING'}
                                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                                          status === 'RUNNING'
                                            ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                            : 'bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700'
                                        }`}
                                      >
                                        {result ? 'Re-run' : 'Run Compare'}
                                      </button>

                                      {canInspect && result ? (
                                        <button
                                          onClick={() => inspectWidget(result)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-blue-600 transition-all"
                                        >
                                          <Link2 size={12} /> Inspect
                                        </button>
                                      ) : null}

                                      {result ? (
                                        <button
                                          onClick={() => exportWidgetProofCsv(result)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-all"
                                        >
                                          <Download size={12} /> Output CSV
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
      `}</style>
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
  tone: 'slate' | 'blue' | 'emerald' | 'rose';
}) {
  const toneClass =
    tone === 'blue'
      ? 'text-blue-600'
      : tone === 'emerald'
        ? 'text-emerald-600'
        : tone === 'rose'
          ? 'text-rose-600'
          : 'text-slate-700';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{label}</div>
      <div className={`text-3xl font-black ${toneClass}`}>{value}</div>
    </div>
  );
}
