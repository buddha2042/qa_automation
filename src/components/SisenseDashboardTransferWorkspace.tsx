'use client';

import { useMemo, useState } from 'react';

interface Props {
  initialBaseUrl: string;
  initialToken: string;
}

interface DashboardOption {
  dashboardId: string;
  dashboardTitle: string;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  currentOwnerEmail: string | null;
  currentOwnerTenantId: string | null;
  currentOwnerTenantName?: string | null;
}

interface UserOption {
  userId: string;
  userName: string | null;
  fullName: string;
  email: string | null;
  tenantId: string | null;
  tenantName?: string | null;
}

interface ApiResponse {
  data?: {
    dashboards?: DashboardOption[];
    users?: UserOption[];
    summary?: {
      totalDashboards?: number;
      totalUsers?: number;
    };
    success?: boolean;
  };
  error?: string;
}

export default function SisenseDashboardTransferWorkspace({ initialBaseUrl, initialToken }: Props) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState(initialToken);
  const [tenantQuery, setTenantQuery] = useState('');
  const [loading, setLoading] = useState<'load' | 'transfer' | ''>('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dashboards, setDashboards] = useState<DashboardOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [selectedDashboardId, setSelectedDashboardId] = useState('');
  const [selectedTargetUserId, setSelectedTargetUserId] = useState('');

  const selectedDashboard = dashboards.find((dashboard) => dashboard.dashboardId === selectedDashboardId) ?? null;
  const selectedTargetUser = users.find((user) => user.userId === selectedTargetUserId) ?? null;
  const uniqueDashboards = useMemo(() => {
    const seen = new Set<string>();
    return dashboards.filter((dashboard) => {
      const key = dashboard.dashboardId.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [dashboards]);
  const filteredDashboards = useMemo(() => {
    const query = dashboardSearch.trim().toLowerCase();
    if (!query) return uniqueDashboards;

    return uniqueDashboards.filter((dashboard) =>
      [dashboard.dashboardTitle, dashboard.dashboardId, dashboard.currentOwnerName, dashboard.currentOwnerEmail]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [dashboardSearch, uniqueDashboards]);

  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        ...user,
        searchLabel: [user.fullName, user.email, user.userName, user.tenantName ?? user.tenantId].filter(Boolean).join(' • '),
      })),
    [users]
  );

  const load = async () => {
    if (!baseUrl.trim() || !token.trim()) {
      setError('Environment URL and token are required.');
      return;
    }

    setLoading('load');
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/excel/sisense/dashboard-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'load',
          baseUrl: baseUrl.trim(),
          token: token.trim(),
          tenantQuery: tenantQuery.trim(),
        }),
      });

      const json = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(json.error || 'Failed to load dashboards and users.');

      const nextDashboards = json.data?.dashboards ?? [];
      const nextUsers = json.data?.users ?? [];
      setDashboards(nextDashboards);
      setUsers(nextUsers);
      setDashboardSearch('');
      const uniqueDashboardId = nextDashboards.find((dashboard, index, array) =>
        array.findIndex((item) => item.dashboardId === dashboard.dashboardId) === index
      )?.dashboardId;
      setSelectedDashboardId(uniqueDashboardId ?? '');
      setSelectedTargetUserId('');
      setSuccess(
        tenantQuery.trim()
          ? `Loaded ${nextDashboards.length} dashboards and ${nextUsers.length} users for tenant ${tenantQuery.trim()}.`
          : `Loaded ${nextDashboards.length} dashboards and ${nextUsers.length} users from the selected instance.`
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load dashboards and users.');
    } finally {
      setLoading('');
    }
  };

  const transfer = async () => {
    if (!selectedDashboard || !selectedTargetUser) {
      setError('Select both the dashboard and the target user.');
      return;
    }

    setLoading('transfer');
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/excel/sisense/dashboard-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transfer',
          baseUrl: baseUrl.trim(),
          token: token.trim(),
          dashboardId: selectedDashboard.dashboardId,
          dashboardTitle: selectedDashboard.dashboardTitle,
          targetUserId: selectedTargetUser.userId,
          targetUserName: selectedTargetUser.fullName,
        }),
      });

      const json = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(json.error || 'Dashboard transfer failed.');

      setDashboards((current) =>
        current.map((dashboard) =>
          dashboard.dashboardId === selectedDashboard.dashboardId
            ? {
                ...dashboard,
                currentOwnerId: selectedTargetUser.userId,
                currentOwnerName: selectedTargetUser.fullName,
                currentOwnerEmail: selectedTargetUser.email,
                currentOwnerTenantId: selectedTargetUser.tenantId,
              }
            : dashboard
        )
      );
      setSuccess(`Request completed. "${selectedDashboard.dashboardTitle}" was transferred to ${selectedTargetUser.fullName}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Dashboard transfer failed.');
    } finally {
      setLoading('');
    }
  };

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-4">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-700">Dashboard Transfer</p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Sisense dashboard ownership transfer</h2>
        <p className="mt-2 max-w-4xl text-sm text-slate-600">
          Enter the target Sisense instance URL and token below. This workspace only loads dashboards and users from that selected instance, then lets you transfer dashboard ownership inside that same environment.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          This workspace uses the Sisense dashboard ownership API, so the selected dashboard and target user must exist in the same environment.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="Target instance URL"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Bearer token or raw token"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <input
          value={tenantQuery}
          onChange={(event) => setTenantQuery(event.target.value)}
          placeholder="Exact tenant name, e.g. SDAO"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={load}
          disabled={loading === 'load'}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
        >
          {loading === 'load' ? 'Loading...' : 'Load Dashboards and Users'}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {success ? <p className="mt-3 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Left Side</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Dashboard Selection</h3>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Search Dashboard
            <input
              value={dashboardSearch}
              onChange={(event) => setDashboardSearch(event.target.value)}
              placeholder="Type dashboard name or id"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Dashboard
            <select
              value={selectedDashboardId}
              onChange={(event) => setSelectedDashboardId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select dashboard</option>
              {filteredDashboards.map((dashboard) => (
                <option key={dashboard.dashboardId} value={dashboard.dashboardId}>
                  {dashboard.dashboardTitle}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Current Owner</p>
            <p className="mt-2">{selectedDashboard?.currentOwnerName ?? '-'}</p>
            <p className="text-xs text-slate-500">{selectedDashboard?.currentOwnerEmail ?? selectedDashboard?.currentOwnerId ?? '-'}</p>
            <p className="mt-3 font-semibold text-slate-900">Tenant</p>
            <p className="mt-1 text-xs text-slate-500">{selectedDashboard?.currentOwnerTenantName ?? selectedDashboard?.currentOwnerTenantId ?? '-'}</p>
            <p className="mt-3 font-semibold text-slate-900">Dashboard ID</p>
            <p className="mt-1 text-xs text-slate-500">{selectedDashboard?.dashboardId ?? '-'}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Right Side</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Target User Selection</h3>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Transfer To User
            <select
              value={selectedTargetUserId}
              onChange={(event) => setSelectedTargetUserId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select user</option>
              {userOptions.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.searchLabel}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Target Owner</p>
            <p className="mt-2">{selectedTargetUser?.fullName ?? '-'}</p>
            <p className="text-xs text-slate-500">{selectedTargetUser?.email ?? selectedTargetUser?.userId ?? '-'}</p>
            <p className="mt-3 font-semibold text-slate-900">Tenant</p>
            <p className="mt-1 text-xs text-slate-500">{selectedTargetUser?.tenantName ?? selectedTargetUser?.tenantId ?? '-'}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] p-4">
        <p className="text-sm font-semibold text-slate-900">Transfer Preview</p>
        <p className="mt-2 text-sm text-slate-600">
          Dashboard: <span className="font-medium text-slate-900">{selectedDashboard?.dashboardTitle ?? '-'}</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          From: <span className="font-medium text-slate-900">{selectedDashboard?.currentOwnerName ?? '-'}</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          To: <span className="font-medium text-slate-900">{selectedTargetUser?.fullName ?? '-'}</span>
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={transfer}
            disabled={loading === 'transfer' || !selectedDashboard || !selectedTargetUser}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
          >
            {loading === 'transfer' ? 'Transferring...' : 'Transfer Dashboard Ownership'}
          </button>
        </div>
      </div>
    </section>
  );
}
