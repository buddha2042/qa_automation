'use client';

import { useState } from 'react';

interface Props {
  initialBaseUrl: string;
  initialToken: string;
  mode?: 'widget' | 'function' | 'user';
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
      focusUserQuery?: string;
      focusUserCount?: number;
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
    focusUserDetails?: Array<{
      userId: string;
      userName: string | null;
      fullName: string | null;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      tenantId: string | null;
      tenantName: string | null;
      roleName: string | null;
      roles: string[];
      groups: string[];
      ownedDashboards: Array<{
        dashboardId: string;
        dashboardTitle: string;
        sharedWith: Array<{
          principalId: string | null;
          principalName: string;
          principalType: string | null;
          permission: string | null;
        }>;
      }>;
      status: string | null;
      active: boolean | null;
      createdDate: string | null;
      lastLoginDate: string | null;
      rawJson: string;
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

const escapeCsv = (value: string | number | boolean | null | undefined) =>
  `"${String(value ?? '').replace(/"/g, '""')}"`;

const normalizeKnownSisenseRoleLabel = (value: string) => {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'consumer') return 'Viewer';
  return value;
};

const formatReadableLabel = (value: string | null | undefined) => {
  const text = String(value ?? '').trim();
  if (!text) return '-';

  return normalizeKnownSisenseRoleLabel(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatReadableList = (values: string[]) => {
  if (values.length === 0) return '-';
  return values.map((value) => formatReadableLabel(value)).join(', ');
};

const formatReadableListForCsv = (values: string[]) => {
  if (values.length === 0) return '-';
  return values.map((value) => formatReadableLabel(value)).join('\n');
};

const formatDashboardShareList = (
  dashboards: Array<{
    dashboardId: string;
    dashboardTitle: string;
    sharedWith: Array<{
      principalId: string | null;
      principalName: string;
      principalType: string | null;
      permission: string | null;
    }>;
  }>,
  multiline = false
) => {
  if (!dashboards.length) return '-';

  const separator = multiline ? '\n' : ', ';
  const lines = dashboards
    .filter((dashboard) => dashboard.sharedWith.length > 0)
    .map((dashboard) => {
      const recipients = dashboard.sharedWith
        .map((share) => {
          const permissionLabel = share.permission ? ` (${formatReadableLabel(share.permission)})` : '';
          return `${share.principalName}${permissionLabel}`;
        })
        .join(multiline ? '; ' : '; ');
      return `${dashboard.dashboardTitle}: ${recipients}`;
    });

  return lines.length > 0 ? lines.join(separator) : '-';
};

export default function SisenseUserDashboardInventory({
  initialBaseUrl,
  initialToken,
  mode = 'widget',
}: Props) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState(initialToken);
  const [focusWidgetType, setFocusWidgetType] = useState('tablewidgetagg');
  const [focusFunction, setFocusFunction] = useState('');
  const [focusUserQuery, setFocusUserQuery] = useState('');
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
    focusUserQuery: '',
    focusUserCount: 0,
  });
  const [widgetTypeBreakdown, setWidgetTypeBreakdown] = useState<Array<{ widgetType: string; count: number }>>([]);
  const [focusWidgetDetails, setFocusWidgetDetails] = useState<
    NonNullable<NonNullable<ApiResponse['data']>['focusWidgetDetails']>
  >([]);
  const [focusFunctionDetails, setFocusFunctionDetails] = useState<
    NonNullable<NonNullable<ApiResponse['data']>['focusFunctionDetails']>
  >([]);
  const [focusUserDetails, setFocusUserDetails] = useState<
    NonNullable<NonNullable<ApiResponse['data']>['focusUserDetails']>
  >([]);
  const [expandFocusWidgetDetails, setExpandFocusWidgetDetails] = useState(false);
  const [expandFocusFunctionDetails, setExpandFocusFunctionDetails] = useState(false);
  const [expandFocusUserDetails, setExpandFocusUserDetails] = useState(false);

  const resolvedFocusWidgetType = focusWidgetType.trim() || 'tablewidgetagg';
  const resolvedFocusFunction = focusFunction.trim();
  const resolvedFocusUserQuery = focusUserQuery.trim();
  const isWidgetMode = mode === 'widget';
  const isFunctionMode = mode === 'function';
  const isUserMode = mode === 'user';
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
  const userSummaryLabel = summary.focusUserQuery
    ? `Matched Users for ${summary.focusUserQuery}`
    : 'Matched Users';

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

  const exportFocusUserCsv = () => {
    if (!focusUserDetails || focusUserDetails.length === 0) return;

    const headers = [
      'User ID',
      'Username',
      'Full Name',
      'First Name',
      'Last Name',
      'Email',
      'Tenant ID',
      'Tenant Name',
      'Role Name',
      'Roles',
      'Groups',
      'Owned Dashboards',
      'Owned Dashboard IDs',
      'Dashboard Shared With',
      'Status',
    ];
    const rows = focusUserDetails.map((row) => [
      row.userId,
      row.userName,
      row.fullName,
      row.firstName,
      row.lastName,
      row.email,
      row.tenantId,
      row.tenantName,
      formatReadableLabel(row.roleName),
      formatReadableListForCsv(row.roles),
      formatReadableListForCsv(row.groups),
      row.ownedDashboards.map((dashboard) => dashboard.dashboardTitle).join('\n') || '-',
      row.ownedDashboards.map((dashboard) => dashboard.dashboardId).join('\n') || '-',
      formatDashboardShareList(row.ownedDashboards, true),
      row.status ?? (row.active === null ? '-' : row.active ? 'Active' : 'Inactive'),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${summary.focusUserQuery || resolvedFocusUserQuery || 'user-lookup'}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    if (!baseUrl.trim() || !token.trim()) {
      setError('Environment URL and token are required.');
      return;
    }

    if (isUserMode && !resolvedFocusUserQuery) {
      setError('Tenant, name, or email search is required.');
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
      focusUserQuery: resolvedFocusUserQuery,
      focusUserCount: 0,
    });
    setWidgetTypeBreakdown([]);
    setFocusWidgetDetails([]);
    setFocusFunctionDetails([]);
    setFocusUserDetails([]);

    try {
      const response = await fetch('/api/excel/sisense/user-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          token: token.trim(),
          focusWidgetType: resolvedFocusWidgetType,
          focusFunction: resolvedFocusFunction,
          focusUserQuery: resolvedFocusUserQuery,
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
        focusUserQuery: json.data?.summary?.focusUserQuery ?? resolvedFocusUserQuery,
        focusUserCount: json.data?.summary?.focusUserCount ?? 0,
      });
      setWidgetTypeBreakdown(json.data?.widgetTypeBreakdown ?? []);
      setFocusWidgetDetails(json.data?.focusWidgetDetails ?? []);
      setFocusFunctionDetails(json.data?.focusFunctionDetails ?? []);
      setFocusUserDetails(json.data?.focusUserDetails ?? []);
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
          {isWidgetMode ? 'Widget Inventory' : isUserMode ? 'User Lookup' : 'Function Lookup'}
        </p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">
          {isWidgetMode
            ? 'Sisense widget inventory and audit'
            : isUserMode
              ? 'Sisense user lookup and tenant audit'
              : 'Sisense function lookup and audit'}
        </h2>
        {isWidgetMode ? (
          <>
          <p className="mt-2 max-w-4xl text-sm text-slate-600">
            This tool connects to the Sisense environment with the URL and token you provide, reads user records from the environment, and can also scan admin dashboards and widget payloads when you use the widget or function modes.
          </p>
          <p className="mt-2 max-w-4xl text-sm text-slate-600">
            After the full scan is complete, the widget type field lets you focus on one specific widget type such as <code>tablewidgetagg</code>, <code>pivot2</code>, or any custom type you enter. The detail table then shows matching widgets only, including dashboard name, widget name, widget type, owner, tenant, and datasource information.
          </p>
          </>
        ) : isUserMode ? (
          null
        ) : (
          <>
          <p className="mt-2 max-w-4xl text-sm text-slate-600">
            This tool connects to the Sisense environment with the URL and token you provide, reads user records from the environment, and can also scan admin dashboards and widget payloads when you use the widget or function modes.
          </p>
          <p className="mt-2 max-w-4xl text-sm text-slate-600">
            The function field performs a deeper search across each fetched widget payload, including JAQL formulas, metadata panels, filters, query metadata, and widget script content. Enter a function such as <code>rank</code>, <code>datediff</code>, or another expression keyword to list widgets that use it anywhere in the payload.
          </p>
          </>
        )}
        {!isUserMode ? (
        <p className="mt-2 text-xs text-slate-500">
          {isWidgetMode
            ? 'Outputs on this screen: environment totals, widget type breakdown, and an exportable CSV for the selected widget type details.'
            : isUserMode
              ? 'Outputs on this screen: total users in the environment, matched users for the search term, and an exportable user lookup table with tenant and identity fields.'
              : 'Outputs on this screen: environment totals and an exportable function lookup showing every widget where the selected function is found.'}
        </p>
        ) : null}
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
        ) : isUserMode ? (
          <input
            value={focusUserQuery}
            onChange={(event) => setFocusUserQuery(event.target.value)}
            placeholder="Exact tenant name or user search, e.g. SDAO"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
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
        {isUserMode ? (
          <>
            <SummaryCard label={userSummaryLabel} value={summary.focusUserCount} />
          </>
        ) : (
          <>
            <SummaryCard label="Total Users" value={summary.totalUsers} />
            <SummaryCard label="Total Dashboards" value={summary.totalDashboards} />
            <SummaryCard label="Total Widgets" value={summary.totalWidgets} />
            <SummaryCard
              label={isWidgetMode ? displayWidgetType(summary.focusWidgetType) : functionSummaryLabel}
              value={isWidgetMode ? summary.focusWidgetCount : summary.focusFunctionCount}
            />
          </>
        )}
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
                        <div className="text-xs text-slate-500">
                          {row.datasourceFullname ?? row.datasourceDatabase ?? row.datasourceAddress ?? '-'}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {isFunctionMode ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{summary.focusFunction || 'Function'} Inventory</h3>
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

      {isUserMode ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{summary.focusUserQuery || 'User'} Lookup</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Matching users for <code>{summary.focusUserQuery || 'your search'}</code> across tenant, email, and profile fields.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportFocusUserCsv}
                disabled={!focusUserDetails || focusUserDetails.length === 0}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-60"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => setExpandFocusUserDetails((current) => !current)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
              >
                {expandFocusUserDetails ? 'Collapse' : 'Expand'}
              </button>
            </div>
          </div>
          <div className={`${expandFocusUserDetails ? 'max-h-[760px]' : 'max-h-[360px]'} overflow-auto`}>
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Name</th>
                  <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Email</th>
                  <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Tenant</th>
                  <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Role / Groups</th>
                  <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Owned Dashboards</th>
                  <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Shared With</th>
                  <th className="px-4 py-3 font-semibold uppercase tracking-[0.08em] text-xs">Status</th>
                </tr>
              </thead>
              <tbody>
                {focusUserDetails.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      {summary.focusUserQuery
                        ? <>No users matched <code>{summary.focusUserQuery}</code> in this run.</>
                        : 'Enter a tenant, email, name, or last name and run the lookup to load users.'}
                    </td>
                  </tr>
                ) : (
                  focusUserDetails.map((row, index) => (
                    <tr
                      key={`${row.userId}:${row.email ?? row.userName ?? index}`}
                      className={`border-t border-slate-200 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                    >
                      <td className="px-4 py-2.5 text-slate-800">
                        <div className="font-medium">{row.fullName ?? row.userName ?? row.userId}</div>
                        <div className="text-xs text-slate-500">
                          {row.userName ?? '-'}
                          {row.lastName ? ` • ${row.lastName}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        <div>{row.email ?? '-'}</div>
                        <div className="text-xs text-slate-500">{row.userId}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        <div>{row.tenantName ?? row.tenantId ?? '-'}</div>
                        <div className="text-xs text-slate-500">{row.tenantId ?? '-'}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        <div>{row.roleName ? formatReadableLabel(row.roleName) : formatReadableList(row.roles)}</div>
                        <div className="text-xs text-slate-500">{formatReadableList(row.groups)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        <div>{row.ownedDashboards.length ? `${row.ownedDashboards.length} dashboards` : '-'}</div>
                        <div className="text-xs text-slate-500">
                          {row.ownedDashboards.length
                            ? row.ownedDashboards
                                .map((dashboard) => `${dashboard.dashboardTitle} (${dashboard.dashboardId})`)
                                .join(', ')
                            : '-'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        <div className="text-xs text-slate-500">
                          {formatDashboardShareList(row.ownedDashboards)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        <div>{row.status ?? (row.active === null ? '-' : row.active ? 'Active' : 'Inactive')}</div>
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
