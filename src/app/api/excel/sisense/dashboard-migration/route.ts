import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer, type SisenseAuthInput } from '@/lib/sisenseAuth';

export const runtime = 'nodejs';

type MigrationAction =
  | 'load-users'
  | 'load-user-dashboards'
  | 'stage-dashboards'
  | 'list-staged'
  | 'clear-staged'
  | 'remove-staged'
  | 'import-staged';

interface RequestBody {
  action?: MigrationAction;
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  tenantQuery?: string;
  userId?: string;
  dashboardIds?: string[];
  targetBaseUrl?: string;
  targetToken?: string;
  targetUsername?: string;
  targetPassword?: string;
  targetUserId?: string;
  targetTenantId?: string;
  useTargetTenantHeader?: boolean;
  stagedIds?: string[];
  publishAfterImport?: boolean;
  assignOwnerAfterImport?: boolean;
}

interface RawDashboard {
  oid?: string;
  _id?: string;
  id?: string;
  title?: string;
  name?: string;
  owner?: string | { _id?: string; id?: string; userId?: string };
  userId?: string;
  creator?: string | { _id?: string; id?: string; userId?: string };
  createdBy?: string | { _id?: string; id?: string; userId?: string };
  lastUpdated?: string;
  created?: string;
}

interface RawUser {
  _id?: string;
  userName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  tenantId?: string;
  tenantName?: string;
}

interface StagedDashboardRecord {
  stagedId: string;
  sourceBaseUrl: string;
  sourceDashboardId: string;
  sourceDashboardTitle: string;
  sourceOwnerId: string | null;
  exportedAt: string;
  exportSizeBytes: number;
  dashFileName: string;
}

const STAGING_DIR = path.join(os.tmpdir(), 'qa-automation-dashboard-staging');

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const normalizeId = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  const record = asRecord(value);
  if (!record) return '';

  const candidates = [record.oid, record._id, record.id, record.userId, record.dashboardId, record.widgetId, record.widgetid];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  return '';
};

const isSisenseObjectId = (value: string | null | undefined): boolean =>
  Boolean(value && /^[0-9a-fA-F]{24}$/.test(value.trim()));

const parsePayload = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? await response.json() : await response.text();
};

const getErrorMessage = (payload: unknown, fallback: string): string => {
  if (typeof payload === 'string' && payload.trim()) return payload;
  const record = asRecord(payload);
  if (!record) return fallback;

  const error = asRecord(record.error);
  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  if (typeof record.message === 'string' && record.message.trim()) return record.message;

  return fallback;
};

const parseDashboards = (payload: unknown): RawDashboard[] => {
  if (Array.isArray(payload)) return payload as RawDashboard[];
  const record = asRecord(payload);
  if (!record) return [];

  const candidates = [record.dashboards, record.data, record.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RawDashboard[];
  }

  return [];
};

const parseUsers = (payload: unknown): RawUser[] => {
  if (Array.isArray(payload)) return payload as RawUser[];
  const record = asRecord(payload);
  if (!record) return [];

  const candidates = [record.users, record.data, record.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RawUser[];
  }

  return [];
};

const getUserDisplayName = (user: RawUser): string =>
  `${String(user.firstName ?? '').trim()} ${String(user.lastName ?? '').trim()}`.trim() ||
  String(user.userName ?? '').trim() ||
  String(user.email ?? '').trim() ||
  String(user._id ?? '').trim();

const normalizeTenantLookupValue = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s*\(default\)\s*/g, '')
    .replace(/\s+/g, ' ');

const getDashboardOwnerId = (dashboard: RawDashboard): string =>
  normalizeId(dashboard.owner) ||
  normalizeId(dashboard.userId) ||
  normalizeId(dashboard.creator) ||
  normalizeId(dashboard.createdBy);

async function fetchUsers(baseUrl: string, token: string): Promise<RawUser[]> {
  const response = await fetch(`${baseUrl}/api/v1/users?expand=groups`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Failed to load users (${response.status}).`));
  }

  return parseUsers(payload);
}

async function fetchDashboards(baseUrl: string, token: string): Promise<RawDashboard[]> {
  const response = await fetch(`${baseUrl}/api/v1/dashboards/admin`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Failed to load dashboards (${response.status}).`));
  }

  return parseDashboards(payload);
}

function summarizeUsers(users: RawUser[]) {
  return users
    .map((user) => ({
      userId: String(user._id ?? '').trim(),
      userName: String(user.userName ?? '').trim() || null,
      fullName: getUserDisplayName(user),
      email: String(user.email ?? '').trim() || null,
      tenantId: String(user.tenantId ?? '').trim() || null,
      tenantName: String(user.tenantName ?? '').trim() || null,
    }))
    .filter((user) => Boolean(user.userId))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function filterUsersByTenant(
  users: ReturnType<typeof summarizeUsers>,
  tenantQuery: string
) {
  const normalizedTenantQuery = normalizeTenantLookupValue(tenantQuery);
  if (!normalizedTenantQuery) return users;

  return users.filter((user) => {
    const tenantName = normalizeTenantLookupValue(user.tenantName);
    const tenantId = normalizeTenantLookupValue(user.tenantId);
    return tenantName === normalizedTenantQuery || tenantId === normalizedTenantQuery;
  });
}

function summarizeDashboards(dashboards: RawDashboard[]) {
  const seen = new Set<string>();
  return dashboards
    .map((dashboard) => {
      const dashboardId = normalizeId(dashboard.oid ?? dashboard._id ?? dashboard.id ?? dashboard);
      if (!dashboardId || seen.has(dashboardId)) return null;
      seen.add(dashboardId);

      return {
        dashboardId,
        dashboardTitle: String(dashboard.title ?? dashboard.name ?? dashboardId).trim(),
        ownerId: getDashboardOwnerId(dashboard) || null,
        created: typeof dashboard.created === 'string' ? dashboard.created : null,
        lastUpdated: typeof dashboard.lastUpdated === 'string' ? dashboard.lastUpdated : null,
      };
    })
    .filter((dashboard): dashboard is NonNullable<typeof dashboard> => Boolean(dashboard))
    .sort((a, b) => a.dashboardTitle.localeCompare(b.dashboardTitle));
}

function sanitizeDashboardImportPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDashboardImportPayload(item));
  }

  const record = asRecord(value);
  if (!record) return value;

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'previewLayout' && entry === null) {
      next[key] = [];
      continue;
    }
    next[key] = sanitizeDashboardImportPayload(entry);
  }

  return next;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectDashboardCandidates(
  value: unknown,
  candidates: Array<{ id: string; title: string }>
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectDashboardCandidates(item, candidates));
    return;
  }

  const record = asRecord(value);
  if (!record) return;

  const id = normalizeId(record);
  const titleCandidate = [record.title, record.name, record.dashboardTitle].find(
    (candidate) => typeof candidate === 'string' && candidate.trim()
  );

  if (id && typeof titleCandidate === 'string' && titleCandidate.trim()) {
    candidates.push({ id, title: titleCandidate.trim() });
  }

  Object.values(record).forEach((entry) => collectDashboardCandidates(entry, candidates));
}

function findImportedDashboardId(
  importPayload: unknown,
  beforeDashboards: RawDashboard[],
  afterDashboards: RawDashboard[],
  expectedTitle: string
): string | null {
  const payloadCandidates: Array<{ id: string; title: string }> = [];
  collectDashboardCandidates(importPayload, payloadCandidates);

  const normalizedExpectedTitle = expectedTitle.trim().toLowerCase();
  const exactMatch = payloadCandidates.find(
    (candidate) => isSisenseObjectId(candidate.id) && candidate.title.trim().toLowerCase() === normalizedExpectedTitle
  );
  if (exactMatch) return exactMatch.id;
  const validPayloadCandidate = payloadCandidates.find((candidate) => isSisenseObjectId(candidate.id));
  if (validPayloadCandidate?.id) return validPayloadCandidate.id;

  const beforeIds = new Set(beforeDashboards.map((dashboard) => normalizeId(dashboard)));
  const afterSummary = summarizeDashboards(afterDashboards);
  const newDashboards = afterSummary.filter((dashboard) => !beforeIds.has(dashboard.dashboardId));
  const titledMatch = newDashboards.find((dashboard) => dashboard.dashboardTitle.trim().toLowerCase() === normalizedExpectedTitle);
  if (titledMatch) return titledMatch.dashboardId;

  return newDashboards[0]?.dashboardId ?? null;
}

async function ensureStagingDir(): Promise<void> {
  await fs.mkdir(STAGING_DIR, { recursive: true });
}

function toSafeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'dashboard';
}

function getMetaPath(stagedId: string): string {
  return path.join(STAGING_DIR, `${stagedId}.json`);
}

function getDashPath(stagedId: string): string {
  return path.join(STAGING_DIR, `${stagedId}.dash`);
}

async function listStagedDashboards(): Promise<StagedDashboardRecord[]> {
  await ensureStagingDir();
  const entries = await fs.readdir(STAGING_DIR);
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => {
        const raw = await fs.readFile(path.join(STAGING_DIR, entry), 'utf8');
        return JSON.parse(raw) as StagedDashboardRecord;
      })
  );

  return records.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
}

async function saveStagedDashboard(record: StagedDashboardRecord, exportedText: string): Promise<void> {
  await ensureStagingDir();
  await fs.writeFile(getMetaPath(record.stagedId), JSON.stringify(record, null, 2), 'utf8');
  await fs.writeFile(getDashPath(record.stagedId), exportedText, 'utf8');
}

async function readStagedDashboard(stagedId: string): Promise<{ meta: StagedDashboardRecord; dashText: string }> {
  const [metaText, dashText] = await Promise.all([
    fs.readFile(getMetaPath(stagedId), 'utf8'),
    fs.readFile(getDashPath(stagedId), 'utf8'),
  ]);

  return {
    meta: JSON.parse(metaText) as StagedDashboardRecord,
    dashText,
  };
}

async function deleteStagedDashboard(stagedId: string): Promise<void> {
  await Promise.allSettled([
    fs.unlink(getMetaPath(stagedId)),
    fs.unlink(getDashPath(stagedId)),
  ]);
}

async function deleteManyStagedDashboards(stagedIds: string[]): Promise<void> {
  await Promise.all(stagedIds.map((stagedId) => deleteStagedDashboard(stagedId)));
}

async function clearAllStagedDashboards(): Promise<void> {
  const staged = await listStagedDashboards();
  await deleteManyStagedDashboards(staged.map((item) => item.stagedId));
}

async function importDashboardToTarget(
  baseUrl: string,
  token: string,
  exportedText: string,
  parsedExport: unknown
): Promise<{ strategy: string; payload: unknown; attempts: Array<{ endpoint: string; strategy: string; status: number; message: string }> }> {
  const attempts: Array<{ endpoint: string; strategy: string; body: string }> = [];
  const errors: string[] = [];
  const diagnostics: Array<{ endpoint: string; strategy: string; status: number; message: string }> = [];

  if (parsedExport !== null) {
    const sanitized = sanitizeDashboardImportPayload(parsedExport);
    attempts.push({
      endpoint: '/api/v1/dashboards/import/bulk',
      strategy: 'bulk-raw-json',
      body: JSON.stringify(sanitized),
    });

    if (Array.isArray(sanitized)) {
      attempts.push({
        endpoint: '/api/v1/dashboards/import/bulk',
        strategy: 'bulk-wrapped-dashboards',
        body: JSON.stringify({ dashboards: sanitized }),
      });
    } else {
      attempts.push({
        endpoint: '/api/v1/dashboards/import/bulk',
        strategy: 'bulk-array-of-one',
        body: JSON.stringify([sanitized]),
      });
      attempts.push({
        endpoint: '/api/v1/dashboards/import/bulk',
        strategy: 'bulk-wrapped-dashboards',
        body: JSON.stringify({ dashboards: [sanitized] }),
      });
      attempts.push({
        endpoint: '/api/v1/dashboards/import',
        strategy: 'single-raw-json',
        body: JSON.stringify(sanitized),
      });
      attempts.push({
        endpoint: '/api/v1/dashboards/import',
        strategy: 'single-wrapped-dashboard',
        body: JSON.stringify({ dashboard: sanitized }),
      });
      attempts.push({
        endpoint: '/api/v1/dashboards/import',
        strategy: 'single-wrapped-dashboards',
        body: JSON.stringify({ dashboards: [sanitized] }),
      });
    }
  }

  for (const endpoint of ['/api/v1/dashboards/import/bulk', '/api/v1/dashboards/import'] as const) {
    attempts.push({
      endpoint,
      strategy: `${endpoint.endsWith('/bulk') ? 'bulk' : 'single'}-raw-export-text`,
      body: exportedText,
    });
  }

  for (const attempt of attempts) {
    const response = await fetch(`${baseUrl}${attempt.endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: attempt.body,
      cache: 'no-store',
    });

    const payload = await parsePayload(response);
    if (response.ok) {
      return { strategy: attempt.strategy, payload, attempts: diagnostics };
    }

    const message = getErrorMessage(payload, `Dashboard import failed (${response.status}).`);
    diagnostics.push({
      endpoint: attempt.endpoint,
      strategy: attempt.strategy,
      status: response.status,
      message,
    });
    errors.push(`${attempt.strategy}: ${message}`);
  }

  throw new ImportDiagnosticsError(errors.join(' | '), {
    importAttempts: diagnostics,
    createAttempt: null,
  });
}

function extractDashboardObject(payload: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeDashboardImportPayload(payload);
  if (Array.isArray(sanitized)) {
    for (const item of sanitized) {
      const record = extractDashboardObject(item);
      if (record) return record;
    }
    return null;
  }

  const record = asRecord(sanitized);
  if (!record) return null;

  const wrappedDashboard = asRecord(record.dashboard);
  if (wrappedDashboard) return wrappedDashboard;

  if (Array.isArray(record.dashboards)) {
    for (const item of record.dashboards) {
      const nested = asRecord(item);
      if (nested) return nested;
    }
  }

  const hasDashboardShape =
    typeof record.title === 'string' ||
    typeof record.name === 'string' ||
    Array.isArray(record.widgets) ||
    asRecord(record.layout) !== null;

  return hasDashboardShape ? record : null;
}

function buildCreateDashboardPayload(payload: unknown): Record<string, unknown> | null {
  const dashboard = extractDashboardObject(payload);
  if (!dashboard) return null;

  const blockedKeys = new Set([
    '_id',
    'id',
    'oid',
    'owner',
    'ownerId',
    'userId',
    'creator',
    'createdBy',
    'created',
    'createdAt',
    'updatedAt',
    'lastUpdated',
    'lastPublish',
    'lastOpened',
    'usage',
    'permissions',
    'shares',
    'shared',
    'sharing',
    'dashboardAccess',
    'tenant',
    'tenantId',
    'folderId',
    'folder',
  ]);

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dashboard)) {
    if (blockedKeys.has(key)) continue;
    if (key === 'previewLayout' && value === null) {
      next[key] = [];
      continue;
    }
    next[key] = value;
  }

  if (typeof next.title !== 'string' || !next.title.trim()) {
    const fallbackTitle =
      typeof dashboard.title === 'string' && dashboard.title.trim()
        ? dashboard.title.trim()
        : typeof dashboard.name === 'string' && dashboard.name.trim()
          ? dashboard.name.trim()
          : null;
    if (fallbackTitle) next.title = fallbackTitle;
  }

  return next;
}

async function createDashboardOnTarget(
  baseUrl: string,
  token: string,
  dashboardPayload: Record<string, unknown>,
  tenantId?: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (tenantId?.trim()) {
    headers['x-tenant-id'] = tenantId.trim();
  }

  const response = await fetch(`${baseUrl}/api/v1/dashboards`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      dashboard: dashboardPayload,
    }),
    cache: 'no-store',
  });

  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Dashboard create failed (${response.status}).`));
  }

  return payload;
}

class ImportDiagnosticsError extends Error {
  diagnostics: {
    importAttempts?: Array<{ endpoint: string; strategy: string; status: number; message: string }>;
    createAttempt?: { endpoint: string; status: number; message: string } | null;
  };

  constructor(
    message: string,
    diagnostics: {
      importAttempts?: Array<{ endpoint: string; strategy: string; status: number; message: string }>;
      createAttempt?: { endpoint: string; status: number; message: string } | null;
    }
  ) {
    super(message);
    this.name = 'ImportDiagnosticsError';
    this.diagnostics = diagnostics;
  }
}

function fingerprintToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

async function changeOwner(baseUrl: string, token: string, dashboardId: string, targetUserId: string): Promise<unknown> {
  const response = await fetch(
    `${baseUrl}/api/v1/dashboards/${encodeURIComponent(dashboardId)}/change_owner?adminAccess=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ownerId: targetUserId,
        originalOwnerRule: 'edit',
      }),
      cache: 'no-store',
    }
  );

  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Dashboard owner update failed (${response.status}).`));
  }

  return payload;
}

async function publishDashboard(baseUrl: string, token: string, dashboardId: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}/api/v1/dashboards/${encodeURIComponent(dashboardId)}/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Dashboard publish failed (${response.status}).`));
  }

  return payload;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const action = body.action;

    if (action === 'list-staged') {
      const staged = await listStagedDashboards();
      return NextResponse.json({
        data: {
          staged,
          summary: {
            totalStaged: staged.length,
          },
        },
      });
    }

    if (action === 'clear-staged') {
      await clearAllStagedDashboards();
      return NextResponse.json({
        data: {
          staged: [],
          summary: {
            totalStaged: 0,
          },
        },
      });
    }

    if (action === 'remove-staged') {
      const stagedIds = Array.isArray(body.stagedIds)
        ? body.stagedIds.map((stagedId) => String(stagedId).trim()).filter(Boolean)
        : [];

      if (stagedIds.length === 0) {
        return NextResponse.json({ error: 'Select at least one staged dashboard to remove.' }, { status: 400 });
      }

      await deleteManyStagedDashboards(stagedIds);
      const staged = await listStagedDashboards();
      return NextResponse.json({
        data: {
          staged,
          summary: {
            totalStaged: staged.length,
          },
        },
      });
    }

    const baseUrlInput = String(body.baseUrl ?? '').trim();
    const auth: SisenseAuthInput = {
      token: body.token,
      username: body.username,
      password: body.password,
    };

    if ((action === 'load-users' || action === 'load-user-dashboards' || action === 'stage-dashboards') && (!baseUrlInput || !hasSisenseAuth(auth))) {
      return NextResponse.json({ error: 'Sisense URL and authentication are required.' }, { status: 400 });
    }

    if (action === 'load-users') {
      const baseUrl = normalizeBaseUrl(baseUrlInput);
      const token = await resolveSisenseBearer(baseUrl, auth);
      const tenantQuery = String(body.tenantQuery ?? '').trim();
      const users = filterUsersByTenant(summarizeUsers(await fetchUsers(baseUrl, token)), tenantQuery);
      return NextResponse.json({
        data: {
          users,
          summary: {
            totalUsers: users.length,
          },
        },
      });
    }

    if (action === 'load-user-dashboards') {
      const userId = String(body.userId ?? '').trim();
      if (!userId) {
        return NextResponse.json({ error: 'Select a source user first.' }, { status: 400 });
      }

      const baseUrl = normalizeBaseUrl(baseUrlInput);
      const token = await resolveSisenseBearer(baseUrl, auth);
      const dashboards = summarizeDashboards(await fetchDashboards(baseUrl, token)).filter((dashboard) => dashboard.ownerId === userId);

      return NextResponse.json({
        data: {
          dashboards,
          summary: {
            totalDashboards: dashboards.length,
          },
        },
      });
    }

    if (action === 'stage-dashboards') {
      const dashboardIds = Array.isArray(body.dashboardIds)
        ? body.dashboardIds.map((dashboardId) => String(dashboardId).trim()).filter(Boolean)
        : [];

      if (dashboardIds.length === 0) {
        return NextResponse.json({ error: 'Select at least one source dashboard.' }, { status: 400 });
      }

      const baseUrl = normalizeBaseUrl(baseUrlInput);
      const token = await resolveSisenseBearer(baseUrl, auth);
      const dashboardsById = new Map(
        summarizeDashboards(await fetchDashboards(baseUrl, token)).map((dashboard) => [dashboard.dashboardId, dashboard])
      );

      const staged = [];
      for (const dashboardId of dashboardIds) {
        const response = await fetch(`${baseUrl}/api/v1/dashboards/${encodeURIComponent(dashboardId)}/export/dash`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json, text/plain, */*',
          },
          cache: 'no-store',
        });

        const exportedText = await response.text();
        if (!response.ok) {
          return NextResponse.json(
            { error: getErrorMessage(exportedText, `Dashboard export failed (${response.status}).`) },
            { status: response.status }
          );
        }

        const dashboard = dashboardsById.get(dashboardId);
        const stagedId = randomUUID();
        const record: StagedDashboardRecord = {
          stagedId,
          sourceBaseUrl: baseUrl,
          sourceDashboardId: dashboardId,
          sourceDashboardTitle: dashboard?.dashboardTitle ?? dashboardId,
          sourceOwnerId: dashboard?.ownerId ?? null,
          exportedAt: new Date().toISOString(),
          exportSizeBytes: new TextEncoder().encode(exportedText).length,
          dashFileName: `${toSafeSlug(dashboard?.dashboardTitle ?? dashboardId)}-${dashboardId}.dash`,
        };

        await saveStagedDashboard(record, exportedText);
        staged.push(record);
      }

      const allStaged = await listStagedDashboards();
      return NextResponse.json({
        data: {
          staged,
          allStaged,
          summary: {
            exportedCount: staged.length,
            totalStaged: allStaged.length,
          },
        },
      });
    }

    if (action === 'import-staged') {
      const targetBaseUrlInput = String(body.targetBaseUrl ?? '').trim();
      const targetAuth: SisenseAuthInput = {
        token: body.targetToken,
        username: body.targetUsername,
        password: body.targetPassword,
      };
      const targetUserId = String(body.targetUserId ?? '').trim();
      const targetTenantId = String(body.targetTenantId ?? '').trim();
      const useTargetTenantHeader = body.useTargetTenantHeader !== false;
      const stagedIds = Array.isArray(body.stagedIds)
        ? body.stagedIds.map((stagedId) => String(stagedId).trim()).filter(Boolean)
        : [];
      const publishAfterImport = body.publishAfterImport !== false;
      const assignOwnerAfterImport = body.assignOwnerAfterImport !== false;

      if (!targetBaseUrlInput || !hasSisenseAuth(targetAuth)) {
        return NextResponse.json({ error: 'Target Sisense URL and authentication are required.' }, { status: 400 });
      }

      if (stagedIds.length === 0) {
        return NextResponse.json({ error: 'Select at least one staged dashboard.' }, { status: 400 });
      }

      if (assignOwnerAfterImport && !targetUserId) {
        return NextResponse.json({ error: 'Select a target user before importing.' }, { status: 400 });
      }

      const targetBaseUrl = normalizeBaseUrl(targetBaseUrlInput);
      const targetToken = await resolveSisenseBearer(targetBaseUrl, targetAuth);
      const results = [];
      const targetAuthMode = targetAuth.token?.trim() ? 'token' : 'credentials';
      const targetTokenFingerprint = fingerprintToken(targetToken);

      for (const stagedId of stagedIds) {
        try {
          const { meta, dashText } = await readStagedDashboard(stagedId);
          const targetDashboardsBefore = await fetchDashboards(targetBaseUrl, targetToken);
          const parsedExport = tryParseJson(dashText);
          let importResult:
            | { strategy: string; payload: unknown }
            | null = null;
          const warnings: string[] = [];
          let importAttempts: Array<{ endpoint: string; strategy: string; status: number; message: string }> = [];
          let createAttempt: { endpoint: string; status: number; message: string } | null = null;

          try {
            const importOutcome = await importDashboardToTarget(targetBaseUrl, targetToken, dashText, parsedExport);
            importResult = {
              strategy: importOutcome.strategy,
              payload: importOutcome.payload,
            };
            importAttempts = importOutcome.attempts;
          } catch (importError) {
            if (importError instanceof ImportDiagnosticsError) {
              importAttempts = importError.diagnostics.importAttempts ?? [];
            }
            const createPayload = buildCreateDashboardPayload(parsedExport);
            if (!createPayload) {
              throw new ImportDiagnosticsError(
                importError instanceof Error ? importError.message : 'Dashboard import failed.',
                {
                  importAttempts,
                  createAttempt,
                }
              );
            }

            try {
              const createResult = await createDashboardOnTarget(
                targetBaseUrl,
                targetToken,
                createPayload,
                useTargetTenantHeader ? targetTenantId || undefined : undefined
              );
              importResult = {
                strategy:
                  useTargetTenantHeader && targetTenantId
                    ? 'create-dashboard-with-tenant-header'
                    : 'create-dashboard-without-tenant-header',
                payload: createResult,
              };
            } catch (createError) {
              createAttempt = {
                endpoint: '/api/v1/dashboards',
                status: 403,
                message: createError instanceof Error ? createError.message : 'Dashboard create failed.',
              };
              throw new ImportDiagnosticsError(
                createError instanceof Error ? createError.message : 'Dashboard create failed.',
                {
                  importAttempts,
                  createAttempt,
                }
              );
            }
            warnings.push(
              `Import endpoints were rejected, so the app fell back to POST /api/v1/dashboards. Original import error: ${
                importError instanceof Error ? importError.message : 'Unknown import error.'
              }`
            );
          }

          const targetDashboardsAfter = await fetchDashboards(targetBaseUrl, targetToken);
          const importedDashboardId = findImportedDashboardId(
            importResult.payload,
            targetDashboardsBefore,
            targetDashboardsAfter,
            meta.sourceDashboardTitle
          );

          let ownershipUpdated = false;
          let published = false;

          if (assignOwnerAfterImport) {
            if (importedDashboardId && isSisenseObjectId(importedDashboardId)) {
              try {
                await changeOwner(targetBaseUrl, targetToken, importedDashboardId, targetUserId);
                ownershipUpdated = true;
              } catch (ownerError) {
                const ownerMessage =
                  ownerError instanceof Error ? ownerError.message : 'Dashboard owner update failed.';
                const normalizedOwnerMessage = ownerMessage.toLowerCase();
                if (
                  normalizedOwnerMessage.includes('already the dashboard') &&
                  normalizedOwnerMessage.includes('owner')
                ) {
                  ownershipUpdated = true;
                  warnings.push('Selected target user already owns the imported dashboard, so owner assignment was skipped.');
                } else {
                  throw ownerError;
                }
              }
            } else {
              warnings.push('Imported dashboard ID was not a valid Sisense dashboard ID, so owner assignment was skipped.');
            }
          }

          if (publishAfterImport) {
            if (importedDashboardId && isSisenseObjectId(importedDashboardId)) {
              await publishDashboard(targetBaseUrl, targetToken, importedDashboardId);
              published = true;
            } else {
              warnings.push('Imported dashboard ID was not a valid Sisense dashboard ID, so publish was skipped.');
            }
          }

          results.push({
            stagedId,
            sourceDashboardId: meta.sourceDashboardId,
            sourceDashboardTitle: meta.sourceDashboardTitle,
            importedDashboardId,
            importStrategy: importResult.strategy,
            ownershipUpdated,
            published,
            warnings,
            diagnostics: {
              targetBaseUrl,
              targetAuthMode,
              targetTokenFingerprint,
              targetTenantId: useTargetTenantHeader ? targetTenantId || null : null,
              importAttempts,
              createAttempt,
            },
            status: 'SUCCESS',
          });
        } catch (error) {
          const diagnostics =
            error instanceof ImportDiagnosticsError
              ? error.diagnostics
              : undefined;
          results.push({
            stagedId,
            status: 'ERROR',
            message: error instanceof Error ? error.message : 'Dashboard import failed.',
            diagnostics: {
              targetBaseUrl,
              targetAuthMode,
              targetTokenFingerprint,
              targetTenantId: useTargetTenantHeader ? targetTenantId || null : null,
              importAttempts: diagnostics?.importAttempts ?? [],
              createAttempt: diagnostics?.createAttempt ?? null,
            },
          });
        }
      }

      const successCount = results.filter((result) => result.status === 'SUCCESS').length;
      await deleteManyStagedDashboards(stagedIds);
      return NextResponse.json({
        data: {
          results,
          summary: {
            totalRequested: stagedIds.length,
            successCount,
            failureCount: stagedIds.length - successCount,
          },
        },
      });
    }

    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
