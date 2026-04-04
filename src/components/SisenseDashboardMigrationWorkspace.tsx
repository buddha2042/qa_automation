'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BASE_URL_PRESET_OPTIONS,
  getPresetFromUrl,
  getUrlForPreset,
  type BaseUrlPreset,
} from '@/lib/sisenseEnvironments';

interface Props {
  initialBaseUrl: string;
}

interface EnvironmentState {
  preset: BaseUrlPreset;
  baseUrl: string;
  authMode: 'credentials' | 'token';
  username: string;
  password: string;
  token: string;
  tenantQuery: string;
}

interface UserOption {
  userId: string;
  userName: string | null;
  fullName: string;
  email: string | null;
  tenantId: string | null;
  tenantName: string | null;
}

interface DashboardOption {
  dashboardId: string;
  dashboardTitle: string;
  ownerId: string | null;
  created: string | null;
  lastUpdated: string | null;
}

interface StagedDashboard {
  stagedId: string;
  sourceBaseUrl: string;
  sourceDashboardId: string;
  sourceDashboardTitle: string;
  sourceOwnerId: string | null;
  exportedAt: string;
  exportSizeBytes: number;
  dashFileName: string;
}

interface ImportResult {
  stagedId: string;
  status: 'SUCCESS' | 'ERROR';
  sourceDashboardId?: string;
  sourceDashboardTitle?: string;
  importedDashboardId?: string | null;
  importStrategy?: string;
  ownershipUpdated?: boolean;
  published?: boolean;
  warnings?: string[];
  message?: string;
  diagnostics?: {
    targetBaseUrl?: string;
    targetAuthMode?: string;
    targetTokenFingerprint?: string;
    targetTenantId?: string | null;
    importAttempts?: Array<{
      endpoint: string;
      strategy: string;
      status: number;
      message: string;
    }>;
    createAttempt?: {
      endpoint: string;
      status: number;
      message: string;
    } | null;
  };
}

interface ApiResponse {
  data?: {
    users?: UserOption[];
    dashboards?: DashboardOption[];
    staged?: StagedDashboard[];
    allStaged?: StagedDashboard[];
    results?: ImportResult[];
    summary?: Record<string, number>;
  };
  error?: string;
}

const STORAGE_KEY = 'qa-automation-dashboard-migration-v2';

const createEnvironmentState = (initialBaseUrl: string): EnvironmentState => ({
  preset: getPresetFromUrl(initialBaseUrl),
  baseUrl: initialBaseUrl,
  authMode: 'token',
  username: '',
  password: '',
  token: '',
  tenantQuery: '',
});

export default function SisenseDashboardMigrationWorkspace({ initialBaseUrl }: Props) {
  const [source, setSource] = useState<EnvironmentState>(() => createEnvironmentState(initialBaseUrl));
  const [target, setTarget] = useState<EnvironmentState>(() => createEnvironmentState(initialBaseUrl));

  const [sourceUsers, setSourceUsers] = useState<UserOption[]>([]);
  const [targetUsers, setTargetUsers] = useState<UserOption[]>([]);
  const [sourceDashboards, setSourceDashboards] = useState<DashboardOption[]>([]);
  const [stagedDashboards, setStagedDashboards] = useState<StagedDashboard[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  const [sourceUserSearch, setSourceUserSearch] = useState('');
  const [targetUserSearch, setTargetUserSearch] = useState('');
  const [dashboardSearch, setDashboardSearch] = useState('');

  const [selectedSourceUserId, setSelectedSourceUserId] = useState('');
  const [selectedTargetUserId, setSelectedTargetUserId] = useState('');
  const [selectedDashboardIds, setSelectedDashboardIds] = useState<string[]>([]);
  const [selectedStagedIds, setSelectedStagedIds] = useState<string[]>([]);

  const [loading, setLoading] = useState<
    '' | 'source-users' | 'target-users' | 'source-dashboards' | 'stage' | 'staged' | 'import'
  >('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedSourceUser = sourceUsers.find((user) => user.userId === selectedSourceUserId) ?? null;
  const selectedTargetUser = targetUsers.find((user) => user.userId === selectedTargetUserId) ?? null;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        source?: Partial<EnvironmentState>;
        target?: Partial<EnvironmentState>;
      };

      if (saved.source?.baseUrl) {
        setSource((current) => ({
          ...current,
          preset: getPresetFromUrl(saved.source?.baseUrl ?? current.baseUrl),
          baseUrl: saved.source?.baseUrl ?? current.baseUrl,
          authMode: saved.source?.authMode === 'credentials' ? 'credentials' : 'token',
          username: saved.source?.username ?? '',
          token: saved.source?.token ?? '',
          tenantQuery: saved.source?.tenantQuery ?? '',
        }));
      }

      if (saved.target?.baseUrl) {
        setTarget((current) => ({
          ...current,
          preset: getPresetFromUrl(saved.target?.baseUrl ?? current.baseUrl),
          baseUrl: saved.target?.baseUrl ?? current.baseUrl,
          authMode: saved.target?.authMode === 'credentials' ? 'credentials' : 'token',
          username: saved.target?.username ?? '',
          token: saved.target?.token ?? '',
          tenantQuery: saved.target?.tenantQuery ?? '',
        }));
      }

    } catch {
      // Ignore malformed saved state.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          source: {
            baseUrl: source.baseUrl,
            authMode: source.authMode,
            username: source.username,
            token: source.token,
            tenantQuery: source.tenantQuery,
          },
          target: {
            baseUrl: target.baseUrl,
            authMode: target.authMode,
            username: target.username,
            token: target.token,
            tenantQuery: target.tenantQuery,
          },
        })
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [
    source.authMode,
    source.baseUrl,
    source.token,
    source.username,
    source.tenantQuery,
    target.authMode,
    target.baseUrl,
    target.token,
    target.username,
    target.tenantQuery,
  ]);

  useEffect(() => {
    void clearStagedOnLoad();
  }, []);

  const filteredSourceUsers = useMemo(
    () => filterUsers(sourceUsers, sourceUserSearch),
    [sourceUserSearch, sourceUsers]
  );
  const filteredTargetUsers = useMemo(
    () => filterUsers(targetUsers, targetUserSearch),
    [targetUserSearch, targetUsers]
  );
  const filteredDashboards = useMemo(() => {
    const query = dashboardSearch.trim().toLowerCase();
    if (!query) return sourceDashboards;

    return sourceDashboards.filter((dashboard) =>
      [dashboard.dashboardTitle, dashboard.dashboardId].join(' ').toLowerCase().includes(query)
    );
  }, [dashboardSearch, sourceDashboards]);

  const updateEnvironment = (
    side: 'source' | 'target',
    updater: (current: EnvironmentState) => EnvironmentState
  ) => {
    if (side === 'source') {
      setSource((current) => updater(current));
      return;
    }
    setTarget((current) => updater(current));
  };

  const buildAuthPayload = (environment: EnvironmentState) =>
    environment.authMode === 'token'
      ? { token: environment.token.trim() }
      : {
          username: environment.username.trim(),
          password: environment.password,
        };

  const resetMessages = () => {
    setError('');
    setSuccess('');
  };

  async function refreshStaged() {
    setLoading('staged');
    try {
      const response = await fetch('/api/excel/sisense/dashboard-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-staged' }),
      });
      const json = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(json.error || 'Failed to load staged dashboards.');
      const staged = json.data?.staged ?? [];
      setStagedDashboards(staged);
      setSelectedStagedIds((current) => current.filter((stagedId) => staged.some((item) => item.stagedId === stagedId)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load staged dashboards.');
    } finally {
      setLoading('');
    }
  }

  async function clearStagedOnLoad() {
    setLoading('staged');
    try {
      const response = await fetch('/api/excel/sisense/dashboard-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-staged' }),
      });
      const json = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(json.error || 'Failed to clear staged dashboards.');
      setStagedDashboards([]);
      setSelectedStagedIds([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to clear staged dashboards.');
    } finally {
      setLoading('');
    }
  }

  async function loadUsers(side: 'source' | 'target') {
    const environment = side === 'source' ? source : target;
    if (!environment.baseUrl.trim()) {
      setError(`Enter the ${side} environment URL first.`);
      return;
    }

    setLoading(side === 'source' ? 'source-users' : 'target-users');
    resetMessages();
    if (side === 'source') {
      setSourceUsers([]);
      setSelectedSourceUserId('');
      setSourceDashboards([]);
      setSelectedDashboardIds([]);
    } else {
      setTargetUsers([]);
      setSelectedTargetUserId('');
    }

    try {
      const response = await fetch('/api/excel/sisense/dashboard-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'load-users',
          baseUrl: environment.baseUrl.trim(),
          ...buildAuthPayload(environment),
          tenantQuery: environment.tenantQuery.trim(),
        }),
      });
      const json = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(json.error || `Failed to load ${side} users.`);
      const users = json.data?.users ?? [];
      if (side === 'source') {
        setSourceUsers(users);
      } else {
        setTargetUsers(users);
      }
      setSuccess(`Loaded ${users.length} ${side} users.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to load ${side} users.`);
    } finally {
      setLoading('');
    }
  }

  async function loadSourceDashboards() {
    if (!selectedSourceUserId) {
      setError('Choose a source user first.');
      return;
    }

    setLoading('source-dashboards');
    resetMessages();
    setSourceDashboards([]);
    setSelectedDashboardIds([]);

    try {
      const response = await fetch('/api/excel/sisense/dashboard-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'load-user-dashboards',
          baseUrl: source.baseUrl.trim(),
          userId: selectedSourceUserId,
          ...buildAuthPayload(source),
        }),
      });
      const json = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(json.error || 'Failed to load source user dashboards.');
      const dashboards = json.data?.dashboards ?? [];
      setSourceDashboards(dashboards);
      setSuccess(`Loaded ${dashboards.length} dashboards for ${selectedSourceUser?.fullName ?? 'the selected user'}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load source user dashboards.');
    } finally {
      setLoading('');
    }
  }

  async function stageSelectedDashboards() {
    if (selectedDashboardIds.length === 0) {
      setError('Select at least one source dashboard to stage.');
      return;
    }

    setLoading('stage');
    resetMessages();
    setImportResults([]);

    try {
      const response = await fetch('/api/excel/sisense/dashboard-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stage-dashboards',
          baseUrl: source.baseUrl.trim(),
          dashboardIds: selectedDashboardIds,
          ...buildAuthPayload(source),
        }),
      });
      const json = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(json.error || 'Failed to stage selected dashboards.');
      const allStaged = json.data?.allStaged ?? json.data?.staged ?? [];
      setStagedDashboards(allStaged);
      const newlyStaged = json.data?.staged ?? [];
      setSelectedStagedIds(newlyStaged.map((item) => item.stagedId));
      setSuccess(`Staged ${newlyStaged.length} dashboard ${newlyStaged.length === 1 ? 'copy' : 'copies'} in the app.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to stage selected dashboards.');
    } finally {
      setLoading('');
    }
  }

  async function importSelectedStagedDashboards() {
    if (selectedStagedIds.length === 0) {
      setError('Select at least one staged dashboard to import.');
      return;
    }

    setLoading('import');
    resetMessages();
    setImportResults([]);

    try {
      const response = await fetch('/api/excel/sisense/dashboard-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import-staged',
          targetBaseUrl: target.baseUrl.trim(),
          targetUserId: selectedTargetUserId,
          targetTenantId: selectedTargetUser?.tenantId ?? '',
          stagedIds: selectedStagedIds,
          assignOwnerAfterImport: false,
          publishAfterImport: false,
          useTargetTenantHeader: false,
          targetToken: target.authMode === 'token' ? target.token.trim() : undefined,
          targetUsername: target.authMode === 'credentials' ? target.username.trim() : undefined,
          targetPassword: target.authMode === 'credentials' ? target.password : undefined,
        }),
      });
      const json = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(json.error || 'Failed to import staged dashboards.');
      const results = json.data?.results ?? [];
      setImportResults(results);
      const successCount = results.filter((result) => result.status === 'SUCCESS').length;
      setStagedDashboards((current) => current.filter((item) => !selectedStagedIds.includes(item.stagedId)));
      setSelectedStagedIds([]);
      setSuccess(`Imported ${successCount} of ${results.length} staged dashboard ${results.length === 1 ? 'copy' : 'copies'}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to import staged dashboards.');
    } finally {
      setLoading('');
    }
  }

  const toggleSourceDashboard = (dashboardId: string) => {
    setSelectedDashboardIds((current) =>
      current.includes(dashboardId) ? current.filter((item) => item !== dashboardId) : [...current, dashboardId]
    );
  };

  const toggleStagedDashboard = (stagedId: string) => {
    setSelectedStagedIds((current) =>
      current.includes(stagedId) ? current.filter((item) => item !== stagedId) : [...current, stagedId]
    );
  };

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-4">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-700">Dashboard Migration</p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">Copy dashboards from one environment into another</h2>
        <p className="mt-2 max-w-5xl text-sm text-slate-600">
          Log into the source and target environments independently, pick a source user, stage exported dashboard copies inside this app, then import those staged copies into the target environment. The source dashboards remain untouched.
        </p>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      {success ? <p className="mt-4 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <EnvironmentCard
          title="Source Environment"
          environment={source}
          onPresetChange={(preset) =>
            updateEnvironment('source', (current) => ({
              ...current,
              preset,
              baseUrl: getUrlForPreset(preset, current.baseUrl),
            }))
          }
          onBaseUrlChange={(baseUrl) =>
            updateEnvironment('source', (current) => ({
              ...current,
              baseUrl,
              preset: getPresetFromUrl(baseUrl),
            }))
          }
          onAuthModeChange={(authMode) =>
            updateEnvironment('source', (current) => ({
              ...current,
              authMode,
            }))
          }
          onUsernameChange={(username) =>
            updateEnvironment('source', (current) => ({
              ...current,
              username,
            }))
          }
          onPasswordChange={(password) =>
            updateEnvironment('source', (current) => ({
              ...current,
              password,
            }))
          }
          onTokenChange={(token) =>
            updateEnvironment('source', (current) => ({
              ...current,
              token,
            }))
          }
          onTenantQueryChange={(tenantQuery) =>
            updateEnvironment('source', (current) => ({
              ...current,
              tenantQuery,
            }))
          }
          actionLabel={loading === 'source-users' ? 'Loading Users...' : 'Load Source Users'}
          onAction={() => void loadUsers('source')}
          actionDisabled={loading === 'source-users'}
        />

        <EnvironmentCard
          title="Target Environment"
          environment={target}
          onPresetChange={(preset) =>
            updateEnvironment('target', (current) => ({
              ...current,
              preset,
              baseUrl: getUrlForPreset(preset, current.baseUrl),
            }))
          }
          onBaseUrlChange={(baseUrl) =>
            updateEnvironment('target', (current) => ({
              ...current,
              baseUrl,
              preset: getPresetFromUrl(baseUrl),
            }))
          }
          onAuthModeChange={(authMode) =>
            updateEnvironment('target', (current) => ({
              ...current,
              authMode,
            }))
          }
          onUsernameChange={(username) =>
            updateEnvironment('target', (current) => ({
              ...current,
              username,
            }))
          }
          onPasswordChange={(password) =>
            updateEnvironment('target', (current) => ({
              ...current,
              password,
            }))
          }
          onTokenChange={(token) =>
            updateEnvironment('target', (current) => ({
              ...current,
              token,
            }))
          }
          onTenantQueryChange={(tenantQuery) =>
            updateEnvironment('target', (current) => ({
              ...current,
              tenantQuery,
            }))
          }
          actionLabel={loading === 'target-users' ? 'Loading Users...' : 'Load Target Users'}
          onAction={() => void loadUsers('target')}
          actionDisabled={loading === 'target-users'}
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Left Side</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Source User and Dashboards</h3>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Search Source User
            <input
              value={sourceUserSearch}
              onChange={(event) => setSourceUserSearch(event.target.value)}
              placeholder="Type user name or email"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Source User
            <select
              value={selectedSourceUserId}
              onChange={(event) => setSelectedSourceUserId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select user</option>
              {filteredSourceUsers.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {[user.fullName, user.email, user.tenantName ?? user.tenantId].filter(Boolean).join(' • ')}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void loadSourceDashboards()}
            disabled={loading === 'source-dashboards' || !selectedSourceUserId}
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
          >
            {loading === 'source-dashboards' ? 'Loading Dashboards...' : 'Load This User’s Dashboards'}
          </button>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Search Dashboard
            <input
              value={dashboardSearch}
              onChange={(event) => setDashboardSearch(event.target.value)}
              placeholder="Type dashboard name or id"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>{sourceDashboards.length} dashboard(s) loaded</span>
            <button
              type="button"
              onClick={() => setSelectedDashboardIds(filteredDashboards.map((dashboard) => dashboard.dashboardId))}
              className="font-semibold text-blue-700"
            >
              Select All Visible
            </button>
          </div>

          <div className="mt-3 max-h-[380px] space-y-2 overflow-auto pr-1">
            {filteredDashboards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                Load a source user to see their dashboards here.
              </div>
            ) : (
              filteredDashboards.map((dashboard) => {
                const checked = selectedDashboardIds.includes(dashboard.dashboardId);
                return (
                  <button
                    key={`${dashboard.dashboardId}-${dashboard.dashboardTitle}`}
                    type="button"
                    onClick={() => toggleSourceDashboard(dashboard.dashboardId)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      checked ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        readOnly
                        checked={checked}
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{dashboard.dashboardTitle}</p>
                        <p className="mt-1 text-xs text-slate-500">{dashboard.dashboardId}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => void stageSelectedDashboards()}
            disabled={loading === 'stage' || selectedDashboardIds.length === 0}
            className="mt-4 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
          >
            {loading === 'stage' ? 'Staging Dashboards...' : `Stage Selected Dashboards (${selectedDashboardIds.length})`}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Middle</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Staged Dashboard Copies</h3>
          <p className="mt-2 text-sm text-slate-600">
            These are exported copies saved by the app before anything is imported into the target environment.
          </p>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>{stagedDashboards.length} staged file(s)</span>
            <button type="button" onClick={() => void refreshStaged()} className="font-semibold text-blue-700">
              Refresh
            </button>
          </div>

          <div className="mt-3 max-h-[430px] space-y-2 overflow-auto pr-1">
            {stagedDashboards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                Stage dashboard copies from the source side to see them here.
              </div>
            ) : (
              stagedDashboards.map((item) => {
                const checked = selectedStagedIds.includes(item.stagedId);
                return (
                  <button
                    key={item.stagedId}
                    type="button"
                    onClick={() => toggleStagedDashboard(item.stagedId)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      checked ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input type="checkbox" readOnly checked={checked} className="mt-1 h-4 w-4 rounded border-slate-300" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.sourceDashboardTitle}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.dashFileName}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {new Date(item.exportedAt).toLocaleString()} • {item.exportSizeBytes.toLocaleString()} bytes
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Right Side</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900">Target User and Import</h3>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Search Target User
            <input
              value={targetUserSearch}
              onChange={(event) => setTargetUserSearch(event.target.value)}
              placeholder="Type user name or email"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Target User
            <select
              value={selectedTargetUserId}
              onChange={(event) => setSelectedTargetUserId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select user</option>
              {filteredTargetUsers.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {[user.fullName, user.email, user.tenantName ?? user.tenantId].filter(Boolean).join(' • ')}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            Imported dashboards are copied into the target environment as-is. This screen does not reassign ownership or publish after import.
          </div>

          <button
            type="button"
            onClick={() => void importSelectedStagedDashboards()}
            disabled={loading === 'import' || selectedStagedIds.length === 0}
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
          >
            {loading === 'import' ? 'Importing...' : `Import Selected Staged Dashboards (${selectedStagedIds.length})`}
          </button>

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
        <p className="text-sm font-semibold text-slate-900">Run Summary</p>
        <p className="mt-2 text-sm text-slate-600">
          Source user: <span className="font-medium text-slate-900">{selectedSourceUser?.fullName ?? '-'}</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Selected source dashboards: <span className="font-medium text-slate-900">{selectedDashboardIds.length}</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Staged dashboard copies selected for import: <span className="font-medium text-slate-900">{selectedStagedIds.length}</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Target user: <span className="font-medium text-slate-900">{selectedTargetUser?.fullName ?? '-'}</span>
        </p>
      </div>

      {importResults.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-900">Import Results</p>
          <div className="mt-3 space-y-3">
            {importResults.map((result) => (
              <div
                key={result.stagedId}
                className={`rounded-xl border px-3 py-3 text-sm ${
                  result.status === 'SUCCESS'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-rose-200 bg-rose-50 text-rose-900'
                }`}
              >
                <p className="font-semibold">{result.sourceDashboardTitle ?? result.stagedId}</p>
                {result.status === 'SUCCESS' ? (
                  <>
                    <p className="mt-1">Imported dashboard ID: {result.importedDashboardId ?? 'Not detected automatically'}</p>
                    <p className="mt-1">Import strategy: {result.importStrategy ?? 'unknown'}</p>
                    <p className="mt-1">Owner assigned: {result.ownershipUpdated ? 'Yes' : 'No'}</p>
                    <p className="mt-1">Published: {result.published ? 'Yes' : 'No'}</p>
                    {result.diagnostics ? (
                      <>
                        <p className="mt-1 text-xs">Target URL: {result.diagnostics.targetBaseUrl ?? '-'}</p>
                        <p className="mt-1 text-xs">Target auth mode: {result.diagnostics.targetAuthMode ?? '-'}</p>
                        <p className="mt-1 text-xs">Target token fingerprint: {result.diagnostics.targetTokenFingerprint ?? '-'}</p>
                        <p className="mt-1 text-xs">Target tenant id: {result.diagnostics.targetTenantId ?? '-'}</p>
                        {result.diagnostics.importAttempts?.map((attempt) => (
                          <p key={`${attempt.endpoint}-${attempt.strategy}`} className="mt-1 text-xs text-slate-700">
                            {`${attempt.strategy} -> ${attempt.endpoint} -> ${attempt.status}: ${attempt.message}`}
                          </p>
                        ))}
                        {result.diagnostics.createAttempt ? (
                          <p className="mt-1 text-xs text-slate-700">
                            {`create-dashboard -> ${result.diagnostics.createAttempt.endpoint} -> ${result.diagnostics.createAttempt.status}: ${result.diagnostics.createAttempt.message}`}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {result.warnings?.map((warning) => (
                      <p key={warning} className="mt-1 text-amber-800">
                        {warning}
                      </p>
                    ))}
                  </>
                ) : (
                  <>
                    <p className="mt-1">{result.message ?? 'Import failed.'}</p>
                    {result.diagnostics ? (
                      <>
                        <p className="mt-1 text-xs">Target URL: {result.diagnostics.targetBaseUrl ?? '-'}</p>
                        <p className="mt-1 text-xs">Target auth mode: {result.diagnostics.targetAuthMode ?? '-'}</p>
                        <p className="mt-1 text-xs">Target token fingerprint: {result.diagnostics.targetTokenFingerprint ?? '-'}</p>
                        <p className="mt-1 text-xs">Target tenant id: {result.diagnostics.targetTenantId ?? '-'}</p>
                        {result.diagnostics.importAttempts?.map((attempt) => (
                          <p key={`${attempt.endpoint}-${attempt.strategy}`} className="mt-1 text-xs">
                            {`${attempt.strategy} -> ${attempt.endpoint} -> ${attempt.status}: ${attempt.message}`}
                          </p>
                        ))}
                        {result.diagnostics.createAttempt ? (
                          <p className="mt-1 text-xs">
                            {`create-dashboard -> ${result.diagnostics.createAttempt.endpoint} -> ${result.diagnostics.createAttempt.status}: ${result.diagnostics.createAttempt.message}`}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function filterUsers(users: UserOption[], query: string): UserOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return users;

  return users.filter((user) =>
    [user.fullName, user.email, user.userName, user.tenantName, user.tenantId]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  );
}

function EnvironmentCard({
  title,
  environment,
  onPresetChange,
  onBaseUrlChange,
  onAuthModeChange,
  onUsernameChange,
  onPasswordChange,
  onTokenChange,
  onTenantQueryChange,
  actionLabel,
  onAction,
  actionDisabled,
}: {
  title: string;
  environment: EnvironmentState;
  onPresetChange: (preset: BaseUrlPreset) => void;
  onBaseUrlChange: (value: string) => void;
  onAuthModeChange: (value: 'credentials' | 'token') => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onTenantQueryChange: (value: string) => void;
  actionLabel: string;
  onAction: () => void;
  actionDisabled: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{title}</p>

      <div className="mt-4 grid gap-3">
        <select
          value={environment.preset}
          onChange={(event) => onPresetChange(event.target.value as BaseUrlPreset)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {BASE_URL_PRESET_OPTIONS.map((option) => (
            <option key={`${title}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <input
          value={environment.baseUrl}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          disabled={environment.preset !== 'manual'}
          placeholder={`${title} URL`}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50"
        />

        <input
          value={environment.tenantQuery}
          onChange={(event) => onTenantQueryChange(event.target.value)}
          placeholder="Exact tenant name, e.g. SDAO"
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        />

        <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => onAuthModeChange('token')}
            className={`rounded-lg px-3 py-1.5 ${environment.authMode === 'token' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
          >
            Token
          </button>
          <button
            type="button"
            onClick={() => onAuthModeChange('credentials')}
            className={`rounded-lg px-3 py-1.5 ${environment.authMode === 'credentials' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
          >
            Credentials
          </button>
        </div>

        {environment.authMode === 'token' ? (
          <input
            value={environment.token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="Bearer token or raw token"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        ) : (
          <>
            <input
              value={environment.username}
              onChange={(event) => onUsernameChange(event.target.value)}
              placeholder="Username or email"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <input
              type="password"
              value={environment.password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Password"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </>
        )}

        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
