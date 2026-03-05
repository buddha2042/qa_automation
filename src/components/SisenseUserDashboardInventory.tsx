'use client';

import { useState } from 'react';

interface Props {
  initialBaseUrl: string;
  initialToken: string;
}

interface ApiResponse {
  data?: {
    summary?: {
      totalUsers?: number;
      totalDashboards?: number;
      totalWidgets?: number;
      tableWidgetAggCount?: number;
    };
    widgetTypeBreakdown?: Array<{
      widgetType: string;
      count: number;
    }>;
    tableWidgetAggDetails?: Array<{
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
  };
  error?: string;
}

export default function SisenseUserDashboardInventory({ initialBaseUrl, initialToken }: Props) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState(initialToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState({
    totalUsers: 0,
    totalDashboards: 0,
    totalWidgets: 0,
    tableWidgetAggCount: 0,
  });
  const [widgetTypeBreakdown, setWidgetTypeBreakdown] = useState<Array<{ widgetType: string; count: number }>>([]);
  const [tableWidgetAggDetails, setTableWidgetAggDetails] = useState<
    NonNullable<ApiResponse['data']>['tableWidgetAggDetails']
  >([]);
  const [expandTableWidgetAgg, setExpandTableWidgetAgg] = useState(false);
  const displayWidgetType = (widgetType: string) =>
    widgetType.toLowerCase() === 'unknown'
      ? 'Unknown (paldi, text, not listed or native sisense widget)'
      : widgetType;

  const exportWidgetTypeCsv = () => {
    if (widgetTypeBreakdown.length === 0) return;

    const headers = ['Widget Type', 'Total'];
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = widgetTypeBreakdown.map((row) => [displayWidgetType(row.widgetType), row.count]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `widget-type-summary-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportTableWidgetAggCsv = () => {
    if (!tableWidgetAggDetails || tableWidgetAggDetails.length === 0) return;

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
    const rows = tableWidgetAggDetails.map((row) => [
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
    link.download = `tablewidgetagg-details-${Date.now()}.csv`;
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
    setSummary({ totalUsers: 0, totalDashboards: 0, totalWidgets: 0, tableWidgetAggCount: 0 });
    setWidgetTypeBreakdown([]);
    setTableWidgetAggDetails([]);

    try {
      const response = await fetch('/api/excel/sisense/user-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          token: token.trim(),
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
        tableWidgetAggCount: json.data?.summary?.tableWidgetAggCount ?? 0,
      });
      setWidgetTypeBreakdown(json.data?.widgetTypeBreakdown ?? []);
      setTableWidgetAggDetails(json.data?.tableWidgetAggDetails ?? []);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Request failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2">
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
        <button
          type="button"
          onClick={exportWidgetTypeCsv}
          disabled={widgetTypeBreakdown.length === 0}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm disabled:opacity-60"
        >
          Export CSV
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <SummaryCard label="Total Users" value={summary.totalUsers} />
        <SummaryCard label="Total Dashboards" value={summary.totalDashboards} />
        <SummaryCard label="Total Widgets" value={summary.totalWidgets} />
        <SummaryCard label="TableWidgetAgg" value={summary.tableWidgetAggCount} />
      </div>

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

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">TableWidgetAgg Details</h3>
            <p className="mt-0.5 text-xs text-slate-500">Owner, tenant, and datasource details for `tablewidgetagg` widgets.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportTableWidgetAggCsv}
              disabled={!tableWidgetAggDetails || tableWidgetAggDetails.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-60"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => setExpandTableWidgetAgg((current) => !current)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
            >
              {expandTableWidgetAgg ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        <div className={`${expandTableWidgetAgg ? 'max-h-[760px]' : 'max-h-[360px]'} overflow-auto`}>
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
              {tableWidgetAggDetails.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    No `tablewidgetagg` widgets found in this run.
                  </td>
                </tr>
              ) : (
                tableWidgetAggDetails.map((row, index) => (
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
