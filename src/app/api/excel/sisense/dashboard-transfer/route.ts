import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer } from '@/lib/sisenseAuth';

export const runtime = 'nodejs';

interface RequestBody {
  action?: 'load' | 'transfer';
  baseUrl?: string;
  token?: string;
  tenantQuery?: string;
  dashboardId?: string;
  targetUserId?: string;
  dashboardTitle?: string;
  targetUserName?: string;
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const normalizeId = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  const record = asRecord(value);
  if (!record) return '';

  const candidates = [record.oid, record._id, record.id, record.userId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  return '';
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

const rewriteTransferErrorMessage = (
  message: string,
  context: {
    dashboardId: string;
    dashboardTitle: string;
    targetUserId: string;
    targetUserName: string;
  }
): string =>
  message
    .replaceAll(`user (id: ${context.targetUserId})`, `user "${context.targetUserName}"`)
    .replaceAll(`dashboard (id: ${context.dashboardId})`, `dashboard "${context.dashboardTitle}"`);

const getUserDisplayName = (user: RawUser): string =>
  `${String(user.firstName ?? '').trim()} ${String(user.lastName ?? '').trim()}`.trim() ||
  String(user.userName ?? '').trim() ||
  String(user.email ?? '').trim() ||
  String(user._id ?? '').trim();

const getDashboardOwnerId = (dashboard: RawDashboard): string =>
  normalizeId(dashboard.owner) ||
  normalizeId(dashboard.userId) ||
  normalizeId(dashboard.creator) ||
  normalizeId(dashboard.createdBy);

const normalizeTenantLookupValue = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s*\(default\)\s*/g, '')
    .replace(/\s+/g, ' ');

const parseNamedReferences = (payload: unknown): Array<{ id: string; name: string }> => {
  const parseArray = (items: unknown[]) =>
    items
      .map((item) => {
        const record = asRecord(item);
        if (!record) return null;

        const id = normalizeId(record);
        const nameCandidates = [record.name, record.displayName, record.title, record.tenantName];
        const name = nameCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
        if (!id || typeof name !== 'string' || !name.trim()) return null;

        return { id, name: name.trim() };
      })
      .filter((item): item is { id: string; name: string } => Boolean(item));

  if (Array.isArray(payload)) return parseArray(payload);
  const record = asRecord(payload);
  if (!record) return [];

  const candidates = [record.data, record.results, record.tenants];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return parseArray(candidate);
  }

  return [];
};

async function fetchTenantLookup(baseUrl: string, token: string): Promise<Map<string, string>> {
  const endpoints = ['/api/v1/tenants', '/api/tenants'];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) continue;
      const payload = await parsePayload(response);
      const tenants = parseNamedReferences(payload);
      if (tenants.length > 0) {
        return new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
      }
    } catch {
      // Ignore tenant endpoint mismatch and continue.
    }
  }

  return new Map();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    if (!body.baseUrl || !body.token?.trim() || !hasSisenseAuth(body)) {
      return NextResponse.json({ error: 'Sisense URL and token are required.' }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const token = await resolveSisenseBearer(baseUrl, { token: body.token });
    const action = body.action === 'transfer' ? 'transfer' : 'load';
    const tenantQuery = String(body.tenantQuery ?? '').trim();

    if (action === 'load') {
      const [dashboardsResponse, usersResponse] = await Promise.all([
        fetch(`${baseUrl}/api/v1/dashboards/admin`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
        }),
        fetch(`${baseUrl}/api/v1/users?expand=groups`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
        }),
      ]);

      const dashboardsPayload = await parsePayload(dashboardsResponse);
      if (!dashboardsResponse.ok) {
        return NextResponse.json(
          { error: getErrorMessage(dashboardsPayload, `Failed to load dashboards (${dashboardsResponse.status}).`) },
          { status: dashboardsResponse.status }
        );
      }

      const usersPayload = await parsePayload(usersResponse);
      if (!usersResponse.ok) {
        return NextResponse.json(
          { error: getErrorMessage(usersPayload, `Failed to load users (${usersResponse.status}).`) },
          { status: usersResponse.status }
        );
      }

      const users = parseUsers(usersPayload);
      const tenantLookup = await fetchTenantLookup(baseUrl, token);
      const normalizedTenantQuery = normalizeTenantLookupValue(tenantQuery);
      const matchedTenantEntry = tenantQuery
        ? Array.from(tenantLookup.entries()).find(([, tenantName]) => normalizeTenantLookupValue(tenantName) === normalizedTenantQuery)
        : undefined;
      const matchedTenantId = matchedTenantEntry?.[0] ?? null;
      const usersById = new Map(
        users.map((user) => [
          String(user._id ?? '').trim(),
          {
            userId: String(user._id ?? '').trim(),
            userName: String(user.userName ?? '').trim() || null,
            fullName: getUserDisplayName(user),
            email: String(user.email ?? '').trim() || null,
            tenantId: String(user.tenantId ?? '').trim() || null,
            tenantName:
              String(user.tenantName ?? '').trim() ||
              tenantLookup.get(String(user.tenantId ?? '').trim()) ||
              null,
          },
        ])
      );

      const filteredUsers = Array.from(usersById.values())
        .filter((user) => {
          if (!tenantQuery) return true;
          if (matchedTenantId) return user.tenantId === matchedTenantId;

          return (
            normalizeTenantLookupValue(user.tenantName) === normalizedTenantQuery ||
            normalizeTenantLookupValue(user.tenantId) === normalizedTenantQuery
          );
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      const allowedUserIds = new Set(filteredUsers.map((user) => user.userId));

      const dashboards = parseDashboards(dashboardsPayload)
        .map((dashboard) => {
          const dashboardId = normalizeId(dashboard.oid ?? dashboard._id ?? dashboard.id ?? dashboard);
          if (!dashboardId) return null;

          const ownerId = getDashboardOwnerId(dashboard) || null;
          const owner = ownerId ? usersById.get(ownerId) : undefined;

          return {
            dashboardId,
            dashboardTitle: String(dashboard.title ?? dashboard.name ?? dashboardId).trim(),
            currentOwnerId: ownerId,
            currentOwnerName: owner?.fullName ?? owner?.userName ?? null,
            currentOwnerEmail: owner?.email ?? null,
            currentOwnerTenantId: owner?.tenantId ?? null,
            currentOwnerTenantName: owner?.tenantName ?? null,
          };
        })
        .filter((dashboard) => (tenantQuery ? Boolean(dashboard?.currentOwnerId && allowedUserIds.has(dashboard.currentOwnerId)) : true))
        .filter(Boolean)
        .sort((a, b) => String(a?.dashboardTitle ?? '').localeCompare(String(b?.dashboardTitle ?? '')));
      const selectableUsers = filteredUsers;

      return NextResponse.json({
        data: {
          dashboards,
          users: selectableUsers,
          summary: {
            totalDashboards: dashboards.length,
            totalUsers: selectableUsers.length,
          },
        },
      });
    }

    const dashboardId = String(body.dashboardId ?? '').trim();
    const targetUserId = String(body.targetUserId ?? '').trim();
    const dashboardTitle = String(body.dashboardTitle ?? '').trim() || dashboardId;
    const targetUserName = String(body.targetUserName ?? '').trim() || targetUserId;

    if (!dashboardId || !targetUserId) {
      return NextResponse.json({ error: 'Dashboard and target user are required.' }, { status: 400 });
    }

    const transferResponse = await fetch(
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

    const transferPayload = await parsePayload(transferResponse);
    if (!transferResponse.ok) {
      const rawMessage = getErrorMessage(transferPayload, `Dashboard transfer failed (${transferResponse.status}).`);
      return NextResponse.json(
        {
          error: rewriteTransferErrorMessage(rawMessage, {
            dashboardId,
            dashboardTitle,
            targetUserId,
            targetUserName,
          }),
        },
        { status: transferResponse.status }
      );
    }

    return NextResponse.json({
      data: {
        success: true,
        dashboardId,
        targetUserId,
        response: transferPayload,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
