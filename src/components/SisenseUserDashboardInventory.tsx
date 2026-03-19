'use client';

import { useState } from 'react';

interface Props {
  initialBaseUrl: string;
  initialToken: string;
  mode?: 'widget' | 'function';
}

interface ApiResponse {
  data?: {
    summary?: {
      totalUsers?: number;
      totalDashboards?: number;
      totalWidgets?: number;
      focusWidgetType?: string;
      focusWidgetCount?: number;
      focusFunction?: string;
      focusFunctionCount?: number;
    };
    widgetTypeBreakdown?: Array<{
      widgetType: string;
      count: number;
    }>;
    focusWidgetDetails?: Array<{
      dashboardId: string;
      dashboardTitle: string;
      widgetId: string;
      widgetName: string;
      widgetType: string;
      widgetSubType: string | null;
      ownerId: string | null;
      ownerName: string | null;
      ownerEmail: string | null;
      tenantId: string | null;
      datasourceTitle: string | null;
      datasourceFullname: string | null;
      datasourceDatabase: string | null;
      datasourceAddress: string | null;
    }>;
    focusFunctionDetails?: Array<{
      dashboardId: string;
      dashboardTitle: string;
      widgetId: string;
      widgetName: string;
      widgetType: string;
      widgetSubType: string | null;
      ownerId: string | null;
      ownerName: string | null;
      ownerEmail: string | null;
      tenantId: string | null;
      datasourceTitle: string | null;
      datasourceDatabase: string | null;
      datasourceAddress: string | null;
      matches: Array<{
        path: string;
        snippet: string;
      }>;
    }>;
  };
  error?: string;
}

const DEFAULT_WIDGET_TYPE_OPTIONS = [
  'Unknown',
  'pivot2',
  'richtexteditor',
  'chart/column',
  'indicator',
  'chart/pie',
  'chart/line',
  'chart/bar',
  'tablewidget',
  'tablewidgetagg',
  'chart/area',
  'ExportWidgetButton',
  'heatmap',
  'Parameters Widget',
  'chart/funnel',
  'Advanced Date Range Filter',
  'WidgetsTabber',
  'BloX',
  'chart/polar',
  'Advanced Filters Plugin',
  'chart/scatter',
  'map/scatter',
  'map/area',
  'treemap',
  'chart/boxplot',
  'sunburst',
  'histogramwidget',
  'iframewidget',
  'trelliswidget',
  'Widget Toolbar',
  'Indicator Card',
  'Viewer Dashboard 2',
  'Expandable Pivot',
  'Paldi Plugins',
] as const;

export default function SisenseUserDashboardInventory({
  initialBaseUrl,
  initialToken,
  mode = 'widget',
}: Props) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState(initialToken);
  const [focusWidgetType, setFocusWidgetType] = useState('tablewidgetagg');
  const [focusFunction, setFocusFunction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState({
    totalUsers: 0,
    totalDashboards: 0,
    totalWidgets: 0,
    focusWidgetType: 'tablewidgetagg',
    focusWidgetCount: 0,
    focusFunction: '',
    focusFunctionCount: 0,
  });
  const [widgetTypeBreakdown, setWidgetTypeBreakdown] = useState<Array<{ widgetType: string; count: number }>>([]);
  const [focusWidgetDetails, setFocusWidgetDetails] = useState<
    NonNullable<ApiResponse['data']>['focusWidgetDetails']
  >([]);
  const [focusFunctionDetails, setFocusFunctionDetails] = useState<
    NonNullable<ApiResponse['data']>['focusFunctionDetails']
  >([]);
  const [expandFocusWidgetDetails, setExpandFocusWidgetDetails] = useState(false);
  const [expandFocusFunctionDetails, setExpandFocusFunctionDetails] = useState(false);
  const resolvedFocusWidgetType = focusWidgetType.trim() || 'tablewidgetagg';
  const resolvedFocusFunction = focusFunction.trim();
  const isWidgetMode = mode === 'widget';
  const widgetTypeOptions = Array.from(
    new Set([
      ...DEFAULT_WIDGET_TYPE_OPTIONS,
      ...widgetTypeBreakdown.map((row) => row.widgetType).filter(Boolean),
    ])
  );
  const displayWidgetType = (widgetType: string) =>
    widgetType.toLowerCase() === 'unknown'
      ? 'Unknown (paldi, text, not listed or native sisense widget)'
      : widgetType;
  const functionSummaryLabel = summary.focusFunction
    ? `Total ${summary.focusFunction.toUpperCase()} Function Used Across the Environment`
    : 'Total Function Used Across the Environment';

  const exportFocusWidgetCsv = () => {
    if (!focusWidgetDetails || focusWidgetDetails.length === 0) return;

    const headers = [
      'Dashboard ID',
      'Dashboard Title',
      'Widget ID',
      'Widget Name',
      'Widget Type',
      'Widget Subtype',
      'Owner ID',
      'Owner Name',
      'Owner Email',
      'Tenant ID',
      'Datasource Title',
      'Datasource Fullname',
      'Datasource Database',
      'Datasource Address',
    ];
    const escapeCsv = (value: string | number | null | undefined) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = focusWidgetDetails.map((row) => [
      row.dashboardId,
      row.dashboardTitle,
      row.widgetId,
      row.widgetName,
      row.widgetType,
      row.widgetSubType,
      row.ownerId,
      row.ownerName,
      row.ownerEmail,
      row.tenantId,
      row.datasourceTitle,
      row.datasourceFullname,
      row.datasourceDatabase,
      row.datasourceAddress,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${summary.focusWidgetType || resolvedFocusWidgetType}-details-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportFocusFunctionCsv = () => {
    if (!focusFunctionDetails || focusFunctionDetails.length === 0) return;

    const headers = [
      'Dashboard',
      'Widget',
      'Widget Type',
      'Owner Name',
      'Owner Email',
      'Datasource',
      'Dashboard ID',
      'Widget ID',
    ];
    const escapeCsv = (value: string | number | null | undefined) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = focusFunctionDetails.map((row) => [
      row.dashboardTitle,
      row.widgetName,
      row.widgetType,
      row.ownerName,
      row.ownerEmail,
      row.datasourceTitle,
      row.dashboardId,
      row.widgetId,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${summary.focusFunction || resolvedFocusFunction || 'function'}-inventory-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    if (!baseUrl.trim() || !token.trim()) {
      setError('Environment URL and token are required.');
      return;
    }

    setLoading(true);
    setError('');
    setSummary({
      totalUsers: 0,
      totalDashboards: 0,
      totalWidgets: 0,
      focusWidgetType: resolvedFocusWidgetType,
      focusWidgetCount: 0,
      focusFunction: resolvedFocusFunction,
      focusFunctionCount: 0,
    });
    setWidgetTypeBreakdown([]);
    setFocusWidgetDetails([]);
    setFocusFunctionDetails([]);

    try {
      const response = await fetch('/api/excel/sisense/user-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          token: token.trim(),
          focusWidgetType: resolvedFocusWidgetType,
          focusFunction: resolvedFocusFunction,
        }),
      });

      const json = (await response.json()) as ApiResponse;
      if (!response.ok) {
        throw new Error(json.error || 'Request failed');
      }

      setSummary({
        totalUsers: json.data?.summary?.totalUsers ?? 0,
        totalDashboards: json.data?.summary?.totalDashboards ?? 0,
        totalWidgets: json.data?.summary?.totalWidgets ?? 0,
        focusWidgetType: json.data?.summary?.focusWidgetType ?? resolvedFocusWidgetType,
        focusWidgetCount: json.data?.summary?.focusWidgetCount ?? 0,
        focusFunction: json.data?.summary?.focusFunction ?? resolvedFocusFunction,
        focusFunctionCount: json.data?.summary?.focusFunctionCount ?? 0,
      });
      setWidgetTypeBreakdown(json.data?.widgetTypeBreakdown ?? []);
      setFocusWidgetDetails(json.data?.focusWidgetDetails ?? []);
      setFocusFunctionDetails(json.data?.focusFunctionDetails ?? []);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Request failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-4">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-700">
          {isWidgetMode ? 'Widget Inventory' : 'Function Lookup'}
        </p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">
          {isWidgetMode ? 'Sisense widget inventory and audit' : 'Sisense function lookup and audit'}
        </h2>
        <p className="mt-2 max-w-4xl text-sm text-slate-600">
          This tool connects to the Sisense environment with the URL and token you provide, loads the full admin dashboard inventory, reads widget payloads for each dashboard widget, and combines that with user records from the environment. From that scan, it calculates total users, total dashboards, and total widgets across the environment.
        </p>
        {isWidgetMode ? (
          <p className="mt-2 max-w-4xl text-sm text-slate-600">
            After the full scan is complete, the widget type field lets you focus on one specific widget type such as <code>tablewidgetagg</code>, <code>pivot2</code>, or any custom type you enter. The detail table then shows matching widgets only, including dashboard name, widget name, widget type, owner, tenant, and datasource information.
          </p>
        ) : (
          <p className="mt-2 max-w-4xl text-sm text-slate-600">
            The function field performs a deeper search across each fetched widget payload, including JAQL formulas, metadata panels, filters, query metadata, and widget script content. Enter a function such as <code>rank</code>, <code>datediff</code>, or another expression keyword to list widgets that use it anywhere in the payload.
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {isWidgetMode
            ? 'Outputs on this screen: environment totals, widget type breakdown, and an exportable CSV for the selected widget type details.'
            : 'Outputs on this screen: environment totals and an exportable function lookup showing every widget where the selected function is found.'}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://your-sisense-url"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Bearer token or raw token"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        {isWidgetMode ? (
          <>
            <input
              value={focusWidgetType}
              onChange={(event) => setFocusWidgetType(event.target.value)}
              list="widget-type-options"
              placeholder="Choose or type widget type, e.g. tablewidgetagg"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <datalist id="widget-type-options">
              {widgetTypeOptions.map((widgetType) => (
                <option key={widgetType} value={widgetType}>
                  {displayWidgetType(widgetType)}
                </option>
              ))}
            </datalist>
          </>
        ) : (
          <input
            value={focusFunction}
            onChange={(event) => setFocusFunction(event.target.value)}
            placeholder="Function to scan, e.g. rank"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
        >
          {loading ? 'Loading...' : 'Run'}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <SummaryCard label="Total Users" value={summary.totalUsers} />
        <SummaryCard label="Total Dashboards" value={summary.totalDashboards} />
        <SummaryCard label="Total Widgets" value={summary.totalWidgets} />
        <SummaryCard
          label={isWidgetMode ? displayWidgetType(summary.focusWidgetType) : functionSummaryLabel}
          value={isWidgetMode ? summary.focusWidgetCount : summary.focusFunctionCount}
        />
      </div>

      {isWidgetMode ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-900">Widget Type Breakdown</h3>
            <p className="mt-0.5 text-xs text-slate-500">Distribution of widget types across all dashboards.</p>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Widget Type</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {widgetTypeBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-sm text-slate-500">
                    Run the report to load widget type summary.
                  </td>
                </tr>
              ) : (
                widgetTypeBreakdown.map((row, index) => (
                  <tr
                    key={row.widgetType}
                    className={`border-t border-slate-200 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                  >
                    <td className="px-4 py-2.5 text-slate-800">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          row.widgetType.toLowerCase() === 'unknown'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {displayWidgetType(row.widgetType)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                      {row.count.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {isWidgetMode ? (
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{displayWidgetType(summary.focusWidgetType)} Details</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Owner, tenant, and datasource details for <code>{summary.focusWidgetType}</code> widgets.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportFocusWidgetCsv}
              disabled={!focusWidgetDetails || focusWidgetDetails.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-60"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => setExpandFocusWidgetDetails((current) => !current)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
            >
              {expandFocusWidgetDetails ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        <div className={`${expandFocusWidgetDetails ? 'max-h-[760px]' : 'max-h-[360px]'} overflow-auto`}>
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Dashboard</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Widget</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Type</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Owner</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Tenant</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Datasource</th>
              </tr>
            </thead>
            <tbody>
              {focusWidgetDetails.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    No <code>{summary.focusWidgetType}</code> widgets found in this run.
                  </td>
                </tr>
              ) : (
                focusWidgetDetails.map((row, index) => (
                  <tr
                    key={`${row.dashboardId}:${row.widgetId}:${index}`}
                    className={`border-t border-slate-200 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                  >
                    <td className="px-4 py-2.5 text-slate-800">
                      <div className="font-medium">{row.dashboardTitle || row.dashboardId}</div>
                      <div className="text-xs text-slate-500">{row.dashboardId}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div className="font-medium">{row.widgetName || row.widgetId}</div>
                      <div className="text-xs text-slate-500">{row.widgetId}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.widgetType}</div>
                      <div className="text-xs text-slate-500">{row.widgetSubType ?? '-'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.ownerName ?? '-'}</div>
                      <div className="text-xs text-slate-500">{row.ownerEmail ?? row.ownerId ?? '-'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">{row.tenantId ?? '-'}</td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.datasourceTitle ?? '-'}</div>
                      <div className="text-xs text-slate-500">{row.datasourceFullname ?? row.datasourceDatabase ?? row.datasourceAddress ?? '-'}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}

      {!isWidgetMode ? (
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {summary.focusFunction || 'Function'} Inventory
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Matching widgets where <code>{summary.focusFunction || 'your function'}</code> appears in the fetched widget payload.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportFocusFunctionCsv}
              disabled={!focusFunctionDetails || focusFunctionDetails.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-60"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => setExpandFocusFunctionDetails((current) => !current)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
            >
              {expandFocusFunctionDetails ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        <div className={`${expandFocusFunctionDetails ? 'max-h-[760px]' : 'max-h-[360px]'} overflow-auto`}>
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Dashboard</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Widget</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Type</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Owner Name</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Owner Email</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Datasource</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Dashboard ID</th>
                <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Widget ID</th>
              </tr>
            </thead>
            <tbody>
              {focusFunctionDetails.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                    {summary.focusFunction
                      ? <>No widgets matched <code>{summary.focusFunction}</code> in this run.</>
                      : 'Enter a function name and run the inventory to load function matches.'}
                  </td>
                </tr>
              ) : (
                focusFunctionDetails.map((row, index) => (
                  <tr
                    key={`${row.dashboardId}:${row.widgetId}:${index}`}
                    className={`border-t border-slate-200 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                  >
                    <td className="px-4 py-2.5 text-slate-800">
                      <div className="font-medium">{row.dashboardTitle || '-'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div className="font-medium">{row.widgetName || '-'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.widgetType}</div>
                      <div className="text-xs text-slate-500">{row.widgetSubType ?? '-'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.ownerName ?? '-'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.ownerEmail ?? '-'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.datasourceTitle ?? '-'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.dashboardId}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      <div>{row.widgetId}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-1.5 text-3xl font-black tracking-tight text-slate-900">{value.toLocaleString()}</p>
    </div>
  );
}
