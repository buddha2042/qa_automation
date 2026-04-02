import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer } from '@/lib/sisenseAuth';

export const runtime = 'nodejs';

interface RequestBody {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  maxWidgets?: number;
  focusWidgetType?: string;
  focusFunction?: string;
  focusUserQuery?: string;
}

interface RawDashboard {
  oid?: string;
  _id?: string;
  title?: string;
  name?: string;
  owner?: string | { _id?: string; id?: string; userId?: string };
  userId?: string;
  creator?: string | { _id?: string; id?: string; userId?: string };
  createdBy?: string | { _id?: string; id?: string; userId?: string };
  widgets?: Array<string | { oid?: string; _id?: string; id?: string }>;
  layout?: {
    columns?: Array<{
      cells?: Array<{
        subcells?: Array<{
          elements?: Array<{ widgetId?: string; widgetid?: string }>;
        }>;
      }>;
    }>;
  };
  shared?: unknown;
  shares?: unknown;
  permissions?: unknown;
  dashboardAccess?: unknown;
  recipients?: unknown;
}

interface RawUser {
  _id?: string;
  userName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  tenantId?: string;
  tenantName?: string;
  roleId?: string;
  roleName?: string;
  roles?: Array<unknown>;
  groups?: Array<unknown>;
  status?: string;
  createdDate?: string;
  lastLoginDate?: string;
  active?: boolean;
}

interface RawWidget {
  oid?: string;
  _id?: string;
  id?: string;
  title?: string;
  name?: string;
  type?: string;
  subtype?: string;
  owner?: string;
  userId?: string;
  datasource?: {
    title?: string;
    fullname?: string;
    database?: string;
    address?: string;
  };
}

interface OutputWidget {
  widgetId: string;
  widgetName: string;
  widgetType: string | null;
  widgetSubType: string | null;
}

interface OutputDashboard {
  dashboardId: string;
  title: string;
  widgets: OutputWidget[];
}

interface FocusWidgetDetail {
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
}

interface FunctionMatch {
  path: string;
  snippet: string;
}

interface FocusFunctionDetail {
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
  matches: FunctionMatch[];
}

interface FocusUserDetail {
  userId: string;
  userName: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  tenantId: string | null;
  tenantName: string | null;
  roleId: string | null;
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
}

interface NamedReference {
  id: string;
  name: string;
}

const MAX_WIDGETS_DEFAULT = 5000;
const MAX_WIDGETS_HARD = 50000;
const WIDGET_ENDPOINT_CONCURRENCY = 10;
const FUNCTION_MATCH_PREVIEW_LIMIT = 12;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const normalizeId = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  const obj = asRecord(value);
  if (!obj) return '';

  const candidates = [obj.oid, obj._id, obj.id, obj.widgetId, obj.widgetid, obj.dashboardId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
};

const parseDashboards = (payload: unknown): RawDashboard[] => {
  if (Array.isArray(payload)) return payload as RawDashboard[];
  const obj = asRecord(payload);
  if (!obj) return [];

  const candidates = [obj.dashboards, obj.data, obj.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RawDashboard[];
  }

  return [];
};

interface DashboardShareEntry {
  principalId: string | null;
  principalName: string | null;
  principalType: string | null;
  permission: string | null;
}

const normalizeSharePrincipalType = (value: unknown): string | null => {
  const text = compactText(value)?.toLowerCase() ?? '';
  if (!text) return null;
  if (text.includes('user')) return 'user';
  if (text.includes('group')) return 'group';
  if (text.includes('tenant')) return 'tenant';
  return text;
};

const normalizeSharePermission = (value: unknown): string | null => compactText(value) ?? null;

const parseDashboardShareEntries = (dashboard: RawDashboard): DashboardShareEntry[] => {
  const results: DashboardShareEntry[] = [];
  const seen = new Set<string>();

  const collect = (value: unknown, hintedType?: string | null, depth = 0) => {
    if (depth > 4 || value == null) return;

    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, hintedType, depth + 1));
      return;
    }

    const record = asRecord(value);
    if (!record) return;

    const principalId =
      compactTextFromCandidates(
        record.userId,
        record.groupId,
        record.tenantId,
        record.subjectId,
        record.shareId,
        record.id,
        record._id,
        record.oid
      ) || null;
    const principalType =
      normalizeSharePrincipalType(record.type) ||
      normalizeSharePrincipalType(record.shareType) ||
      normalizeSharePrincipalType(record.principalType) ||
      normalizeSharePrincipalType(record.objectType) ||
      normalizeSharePrincipalType(hintedType) ||
      (record.userId ? 'user' : record.groupId ? 'group' : record.tenantId ? 'tenant' : null);
    const principalName =
      compactTextFromCandidates(
        record.name,
        record.displayName,
        record.title,
        record.userName,
        record.username,
        record.email,
        record.groupName,
        record.tenantName
      ) || null;
    const permission =
      normalizeSharePermission(record.permission) ||
      normalizeSharePermission(record.access) ||
      normalizeSharePermission(record.rights) ||
      normalizeSharePermission(record.level) ||
      normalizeSharePermission(record.role);

    if (principalId || principalName) {
      const key = `${principalType ?? 'unknown'}:${principalId ?? principalName ?? ''}:${permission ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          principalId,
          principalName,
          principalType,
          permission,
        });
      }
    }

    collect(record.users, 'user', depth + 1);
    collect(record.groups, 'group', depth + 1);
    collect(record.tenants, 'tenant', depth + 1);
    collect(record.members, hintedType, depth + 1);
    collect(record.recipients, hintedType, depth + 1);
    collect(record.shares, hintedType, depth + 1);
    collect(record.shared, hintedType, depth + 1);
  };

  collect(dashboard.shared);
  collect(dashboard.shares);
  collect(dashboard.permissions);
  collect(dashboard.dashboardAccess);
  collect(dashboard.recipients);

  return results;
};

const parseUsers = (payload: unknown): RawUser[] => {
  if (Array.isArray(payload)) return payload as RawUser[];
  const obj = asRecord(payload);
  if (!obj) return [];

  const candidates = [obj.users, obj.data, obj.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RawUser[];
  }

  return [];
};

const parseWidget = (payload: unknown): RawWidget | null => {
  const obj = asRecord(payload);
  if (!obj) return null;
  return obj as RawWidget;
};

const normalizeWidgetType = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const truncateSnippet = (value: string, maxLength = 180): string => {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compactText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
};

const compactTextFromCandidates = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = compactText(value);
    if (text) return text;
  }

  return null;
};

const extractStringArray = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];

  return values
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      const record = asRecord(entry);
      if (!record) return '';

      return (
        compactTextFromCandidates(
          record.name,
          record.displayName,
          record.roleName,
          record.groupName,
          record.group,
          record.role,
          record.username,
          record.userName,
          record.email,
          record.id,
          record._id
        ) ??
        ''
      );
    })
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
};

const extractRoleIdsFromGroups = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];

  return values
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return '';
      return compactTextFromCandidates(record.roleId, record.role, record.role_id) ?? '';
    })
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
};

const serializeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const parseNamedReferences = (payload: unknown): NamedReference[] => {
  const parseArray = (items: unknown[]): NamedReference[] =>
    items
      .map((item) => {
        const record = asRecord(item);
        if (!record) return null;

        const id = compactTextFromCandidates(record._id, record.id, record.oid);
        const name = compactTextFromCandidates(
          record.name,
          record.displayName,
          record.title,
          record.groupName,
          record.roleName,
          record.tenantName
        );

        if (!id || !name) return null;
        return { id, name };
      })
      .filter((item): item is NamedReference => Boolean(item));

  if (Array.isArray(payload)) return parseArray(payload);

  const record = asRecord(payload);
  if (!record) return [];

  const candidates = [
    record.data,
    record.results,
    record.users,
    record.groups,
    record.roles,
    record.tenants,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return parseArray(candidate);
    }
  }

  return [];
};

async function fetchNamedReferenceMap(
  baseUrl: string,
  token: string,
  endpoints: string[]
): Promise<Map<string, string>> {
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

      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? ((await response.json()) as unknown)
        : (await response.text());

      const references = parseNamedReferences(payload);
      if (references.length === 0) continue;

      return new Map(references.map((reference) => [reference.id, reference.name]));
    } catch {
      // Ignore unsupported endpoints and continue to the next option.
    }
  }

  return new Map<string, string>();
}

const buildUserSearchText = (user: FocusUserDetail): string =>
  [
    user.userId,
    user.userName,
    user.fullName,
    user.firstName,
    user.lastName,
    user.email,
    user.tenantId,
    user.tenantName,
    user.roleName,
    user.status,
    user.createdDate,
    user.lastLoginDate,
    ...user.roles,
    ...user.groups,
    user.rawJson,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const mapUserDetail = (user: RawUser): FocusUserDetail => {
  const record = asRecord(user) ?? {};
  const tenantRecord = asRecord(record.tenant);
  const roleRecord = asRecord(record.role);
  const primaryGroupRecord = asRecord(record.group);
  const fullName =
    `${String(user.firstName ?? '').trim()} ${String(user.lastName ?? '').trim()}`.trim() ||
    compactText(record.name) ||
    String(user.userName ?? '').trim() ||
    null;
  const groupRoleIds = extractRoleIdsFromGroups(
    user.groups ??
    record.groups ??
    record.userGroups ??
    record.groupNames ??
    record.groupsList ??
    primaryGroupRecord
  );
  const roles = extractStringArray(
    user.roles ??
    record.roles ??
    record.userRoles ??
    record.roleNames ??
    record.rolesList ??
    roleRecord ??
    groupRoleIds
  );
  const groups = extractStringArray(
    user.groups ??
    record.groups ??
    record.userGroups ??
    record.groupNames ??
    record.groupsList ??
    primaryGroupRecord
  );

  return {
    userId: String(user._id ?? '').trim(),
    userName: String(user.userName ?? '').trim() || null,
    fullName,
    firstName: String(user.firstName ?? '').trim() || null,
    lastName: String(user.lastName ?? '').trim() || null,
    email: String(user.email ?? '').trim() || compactText(record.mail) || null,
    tenantId: String(user.tenantId ?? '').trim() || compactText(record.tenant) || compactText(tenantRecord?.id) || compactText(tenantRecord?._id) || null,
    tenantName: compactText(user.tenantName) || compactText(record.tenantName) || compactText(tenantRecord?.name) || compactText(tenantRecord?.displayName) || null,
    roleId: compactTextFromCandidates(user.roleId, record.roleId, roleRecord?._id, roleRecord?.id) || groupRoleIds[0] || null,
    roleName:
      compactTextFromCandidates(
        user.roleName,
        record.roleName,
        roleRecord?.name,
        roleRecord?.displayName,
        record.roleDisplayName
      ) || roles[0] || null,
    roles,
    groups,
    ownedDashboards: [],
    status: compactText(user.status) || compactText(record.status) || null,
    active:
      typeof user.active === 'boolean'
        ? user.active
        : typeof record.active === 'boolean'
          ? (record.active as boolean)
          : null,
    createdDate: compactText(user.createdDate) || compactText(record.createdDate) || compactText(record.createdAt) || null,
    lastLoginDate: compactText(user.lastLoginDate) || compactText(record.lastLoginDate) || compactText(record.lastLogin) || null,
    rawJson: serializeJson(user),
  };
};

const resolveReferenceName = (value: string, lookup: Map<string, string>): string =>
  lookup.get(value) ?? value;

const normalizeTenantLookupValue = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s*\(default\)\s*/g, '')
    .replace(/\s+/g, ' ');

const enrichUserDetail = (
  user: FocusUserDetail,
  referenceLookups: {
    tenants: Map<string, string>;
    groups: Map<string, string>;
    roles: Map<string, string>;
  }
): FocusUserDetail => ({
  ...user,
  tenantName: user.tenantName || (user.tenantId ? resolveReferenceName(user.tenantId, referenceLookups.tenants) : null),
      roleName:
    user.roleName
      ? resolveReferenceName(user.roleName, referenceLookups.roles)
      : user.roleId
        ? resolveReferenceName(user.roleId, referenceLookups.roles)
        : user.roles[0]
          ? resolveReferenceName(user.roles[0], referenceLookups.roles)
        : null,
    roles: user.roles.map((role) => resolveReferenceName(role, referenceLookups.roles)),
    groups: user.groups.map((group) => resolveReferenceName(group, referenceLookups.groups)),
});

const resolveDashboardShareEntry = (
  entry: DashboardShareEntry,
  lookups: {
    users: Map<string, { name: string | null; email: string | null }>;
    groups: Map<string, string>;
    tenants: Map<string, string>;
  }
) => {
  const userRef = entry.principalId ? lookups.users.get(entry.principalId) : null;
  const groupName = entry.principalId ? lookups.groups.get(entry.principalId) : null;
  const tenantName = entry.principalId ? lookups.tenants.get(entry.principalId) : null;
  const resolvedName =
    entry.principalName ||
    userRef?.name ||
    userRef?.email ||
    groupName ||
    tenantName ||
    entry.principalId ||
    'Unknown';

  return {
    principalId: entry.principalId,
    principalName: resolvedName,
    principalType: entry.principalType,
    permission: entry.permission,
  };
};

const extractDashboardOwnerId = (dashboard: RawDashboard): string | null =>
  normalizeId(dashboard.owner) ||
  normalizeId(dashboard.userId) ||
  normalizeId(dashboard.creator) ||
  normalizeId(dashboard.createdBy) ||
  null;

const findFunctionMatches = (
  value: unknown,
  target: string,
  path = '$',
  acc: FunctionMatch[] = []
): FunctionMatch[] => {
  if (!target) return acc;

  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    const normalizedTarget = target.toLowerCase();
    const directMatch = lowered.includes(normalizedTarget);
    const functionPattern = new RegExp(`\\b${escapeRegExp(normalizedTarget)}\\s*\\(`, 'i');
    if (directMatch || functionPattern.test(value)) {
      acc.push({
        path,
        snippet: truncateSnippet(value),
      });
    }
    return acc;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => findFunctionMatches(item, target, `${path}[${index}]`, acc));
    return acc;
  }

  const obj = asRecord(value);
  if (!obj) return acc;

  Object.entries(obj).forEach(([key, nested]) => {
    findFunctionMatches(nested, target, `${path}.${key}`, acc);
  });

  return acc;
};

const extractDashboardWidgetIds = (dashboard: RawDashboard): string[] => {
  const ids = new Set<string>();

  for (const widgetRef of dashboard.widgets ?? []) {
    const id = normalizeId(widgetRef);
    if (id) ids.add(id);
  }

  for (const column of dashboard.layout?.columns ?? []) {
    for (const cell of column.cells ?? []) {
      for (const subcell of cell.subcells ?? []) {
        for (const element of subcell.elements ?? []) {
          const id = normalizeId(element);
          if (id) ids.add(id);
        }
      }
    }
  }

  return Array.from(ids);
};

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    if (!body.baseUrl || !body.token?.trim() || !hasSisenseAuth(body)) {
      return NextResponse.json({ error: 'Sisense URL and token are required.' }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const token = await resolveSisenseBearer(baseUrl, { token: body.token });
    const focusWidgetType = String(body.focusWidgetType ?? 'tablewidgetagg').trim() || 'tablewidgetagg';
    const focusFunction = String(body.focusFunction ?? '').trim();
    const focusUserQuery = String(body.focusUserQuery ?? '').trim();
    const normalizedFocusWidgetType = normalizeWidgetType(focusWidgetType);

    const usersResponse = await fetch(`${baseUrl}/api/v1/users?expand=groups`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const usersContentType = usersResponse.headers.get('content-type') ?? '';
    const usersPayload = usersContentType.includes('application/json')
      ? ((await usersResponse.json()) as unknown)
      : (await usersResponse.text());

    if (!usersResponse.ok) {
      const message = typeof usersPayload === 'string' ? usersPayload : JSON.stringify(usersPayload);
      return NextResponse.json({ error: `Sisense users responded with ${usersResponse.status}: ${message}` }, { status: usersResponse.status });
    }

    const users = parseUsers(usersPayload);
    const totalUsers = users.length;
    const userReferenceLookup = new Map(
      users
        .map((user) => {
          const userId = String(user._id ?? '').trim();
          if (!userId) return null;
          const name =
            `${String(user.firstName ?? '').trim()} ${String(user.lastName ?? '').trim()}`.trim() ||
            String(user.userName ?? '').trim() ||
            null;
          return [
            userId,
            {
              name,
              email: String(user.email ?? '').trim() || null,
            },
          ] as const;
        })
        .filter((entry): entry is readonly [string, { name: string | null; email: string | null }] => Boolean(entry))
    );
    const [tenantLookup, groupLookup, roleLookup] = await Promise.all([
      fetchNamedReferenceMap(baseUrl, token, ['/api/v1/tenants', '/api/tenants']),
      fetchNamedReferenceMap(baseUrl, token, ['/api/v1/groups', '/api/groups']),
      fetchNamedReferenceMap(baseUrl, token, ['/api/v1/roles', '/api/roles']),
    ]);
    let ownedDashboardsByUserId = new Map<string, Array<{
      dashboardId: string;
      dashboardTitle: string;
      sharedWith: Array<{
        principalId: string | null;
        principalName: string;
        principalType: string | null;
        permission: string | null;
      }>;
    }>>();
    if (focusUserQuery) {
      try {
        const adminResponse = await fetch(`${baseUrl}/api/v1/dashboards/admin`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
        });

        if (adminResponse.ok) {
          const adminContentType = adminResponse.headers.get('content-type') ?? '';
          const adminPayload = adminContentType.includes('application/json')
            ? ((await adminResponse.json()) as unknown)
            : (await adminResponse.text());
          const dashboards = parseDashboards(adminPayload);
          ownedDashboardsByUserId = dashboards.reduce((acc, dashboard) => {
            const ownerId = extractDashboardOwnerId(dashboard);
            const dashboardId = normalizeId(dashboard.oid ?? dashboard._id ?? dashboard);
            if (!ownerId || !dashboardId) return acc;
            const sharedWith = parseDashboardShareEntries(dashboard)
              .map((entry) =>
                resolveDashboardShareEntry(entry, {
                  users: userReferenceLookup,
                  groups: groupLookup,
                  tenants: tenantLookup,
                })
              )
              .filter((entry) => entry.principalId !== ownerId)
              .filter((entry) => {
                const ownerRef = userReferenceLookup.get(ownerId);
                const ownerName = ownerRef?.name?.trim().toLowerCase() ?? '';
                const ownerEmail = ownerRef?.email?.trim().toLowerCase() ?? '';
                const principalName = entry.principalName.trim().toLowerCase();
                return principalName !== 'owner' && principalName !== ownerName && principalName !== ownerEmail;
              })
              .filter(
                (entry, index, entries) =>
                  entries.findIndex(
                    (candidate) =>
                      candidate.principalId === entry.principalId &&
                      candidate.principalName === entry.principalName &&
                      candidate.permission === entry.permission
                  ) === index
              );

            const entry = {
              dashboardId,
              dashboardTitle: String(dashboard.title ?? dashboard.name ?? dashboardId).trim(),
              sharedWith,
            };
            const current = acc.get(ownerId) ?? [];
            const existingIndex = current.findIndex((item) => item.dashboardId === dashboardId);
            if (existingIndex >= 0) {
              current[existingIndex] = entry;
            } else {
              current.push(entry);
            }
            acc.set(ownerId, current);
            return acc;
          }, new Map<string, Array<{
            dashboardId: string;
            dashboardTitle: string;
            sharedWith: Array<{
              principalId: string | null;
              principalName: string;
              principalType: string | null;
              permission: string | null;
            }>;
          }>>());
        }
      } catch {
        ownedDashboardsByUserId = new Map();
      }
    }

    const enrichedUsers = users
      .map(mapUserDetail)
      .map((user) =>
        ({
          ...enrichUserDetail(user, {
            tenants: tenantLookup,
            groups: groupLookup,
            roles: roleLookup,
          }),
          ownedDashboards: ownedDashboardsByUserId.get(user.userId) ?? [],
        })
      );
    const normalizedUserQuery = focusUserQuery.toLowerCase();
    const matchedTenantEntry = Array.from(tenantLookup.entries()).find(([, tenantName]) => {
      const normalizedTenantName = normalizeTenantLookupValue(tenantName);
      return normalizedTenantName === normalizeTenantLookupValue(focusUserQuery);
    });
    const matchedTenantId = matchedTenantEntry?.[0] ?? null;
    const focusUserDetails = enrichedUsers.filter((user) => {
      if (!focusUserQuery) return true;
      if (matchedTenantId) return user.tenantId === matchedTenantId;

      return buildUserSearchText(user).includes(normalizedUserQuery);
    });
    const matchedDashboardIds = new Set(
      focusUserDetails.flatMap((user) => user.ownedDashboards.map((dashboard) => dashboard.dashboardId))
    );
    const matchedWidgetCount = 0;

    if (focusUserQuery) {
      return NextResponse.json({
        data: {
          summary: {
            totalUsers: focusUserDetails.length,
            totalDashboards: matchedDashboardIds.size,
            totalWidgets: matchedWidgetCount,
            focusWidgetType,
            focusWidgetCount: 0,
            focusFunction,
            focusFunctionCount: 0,
            focusUserQuery,
            focusUserCount: focusUserDetails.length,
          },
          widgetTypeBreakdown: [],
          focusWidgetDetails: [],
          focusFunctionDetails: [],
          focusUserDetails,
        },
      });
    }

    const adminResponse = await fetch(`${baseUrl}/api/v1/dashboards/admin`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const adminContentType = adminResponse.headers.get('content-type') ?? '';
    const adminPayload = adminContentType.includes('application/json')
      ? ((await adminResponse.json()) as unknown)
      : (await adminResponse.text());

    if (!adminResponse.ok) {
      const message = typeof adminPayload === 'string' ? adminPayload : JSON.stringify(adminPayload);
      return NextResponse.json({ error: `Sisense dashboards responded with ${adminResponse.status}: ${message}` }, { status: adminResponse.status });
    }

    const maxWidgets = Math.min(MAX_WIDGETS_HARD, Math.max(1, Number(body.maxWidgets) || MAX_WIDGETS_DEFAULT));
    const usersById = new Map(
      users.map((user) => [
        String(user._id ?? '').trim(),
        {
          ownerName:
            `${String(user.firstName ?? '').trim()} ${String(user.lastName ?? '').trim()}`.trim() ||
            String(user.userName ?? '').trim() ||
            null,
          ownerEmail: String(user.email ?? '').trim() || null,
          tenantId: String(user.tenantId ?? '').trim() || null,
        },
      ])
    );
    const dashboards = parseDashboards(adminPayload);

    const baseRows = dashboards
      .map((dashboard): OutputDashboard | null => {
        const dashboardId = normalizeId(dashboard.oid ?? dashboard._id ?? dashboard);
        if (!dashboardId) return null;

        const widgetIds = extractDashboardWidgetIds(dashboard);
        return {
          dashboardId,
          title: String(dashboard.title ?? dashboard.name ?? dashboardId).trim(),
          widgets: widgetIds.map((widgetId) => ({
            widgetId,
            widgetName: widgetId,
            widgetType: null,
            widgetSubType: null,
          })),
        };
      })
      .filter((item): item is OutputDashboard => Boolean(item));

    const widgetMap = new Map<string, {
      name: string;
      type: string | null;
      subtype: string | null;
      ownerId: string | null;
      userId: string | null;
      datasourceTitle: string | null;
      datasourceFullname: string | null;
      datasourceDatabase: string | null;
      datasourceAddress: string | null;
      rawPayload: unknown;
    }>();
    let dashboardWidgetCalls = 0;
    let dashboardWidgetCallErrors = 0;

    const widgetDetailTasks: Array<() => Promise<void>> = [];
    for (const dashboard of baseRows) {
      for (const widget of dashboard.widgets) {
        widgetDetailTasks.push(async () => {
          dashboardWidgetCalls += 1;
          try {
            const widgetResponse = await fetch(
              `${baseUrl}/api/v1/dashboards/${encodeURIComponent(dashboard.dashboardId)}/widgets/${encodeURIComponent(widget.widgetId)}`,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/json',
                },
                cache: 'no-store',
              }
            );

            const contentType = widgetResponse.headers.get('content-type') ?? '';
            const payload = contentType.includes('application/json')
              ? ((await widgetResponse.json()) as unknown)
              : (await widgetResponse.text());

            if (!widgetResponse.ok) {
              dashboardWidgetCallErrors += 1;
              return;
            }

            const detail = parseWidget(payload);
            if (!detail) return;

            widgetMap.set(`${dashboard.dashboardId}::${widget.widgetId}`, {
              name: String(detail.title ?? detail.name ?? widget.widgetId).trim(),
              type: typeof detail.type === 'string' && detail.type.trim() ? detail.type.trim() : null,
              subtype: typeof detail.subtype === 'string' && detail.subtype.trim() ? detail.subtype.trim() : null,
              ownerId: String(detail.owner ?? '').trim() || null,
              userId: String(detail.userId ?? '').trim() || null,
              datasourceTitle: String(detail.datasource?.title ?? '').trim() || null,
              datasourceFullname: String(detail.datasource?.fullname ?? '').trim() || null,
              datasourceDatabase: String(detail.datasource?.database ?? '').trim() || null,
              datasourceAddress: String(detail.datasource?.address ?? '').trim() || null,
              rawPayload: payload,
            });
          } catch {
            dashboardWidgetCallErrors += 1;
          }
        });
      }
    }

    await runWithConcurrency(widgetDetailTasks, WIDGET_ENDPOINT_CONCURRENCY);

    let totalWidgetRefs = 0;
    let resolvedWidgetTypes = 0;
    let returnedWidgetRefs = 0;
    let truncated = false;
    const widgetTypeCounts = new Map<string, number>();
    const focusWidgetDetails: FocusWidgetDetail[] = [];
    const focusFunctionDetails: FocusFunctionDetail[] = [];

    const output: OutputDashboard[] = [];

    for (const dashboard of baseRows) {
      const widgets: OutputWidget[] = [];

      for (const widget of dashboard.widgets) {
        totalWidgetRefs += 1;
        const resolved = widgetMap.get(`${dashboard.dashboardId}::${widget.widgetId}`);
        const nextWidget: OutputWidget = {
          widgetId: widget.widgetId,
          widgetName: resolved?.name ?? widget.widgetName,
          widgetType: resolved?.type ?? widget.widgetType,
          widgetSubType: resolved?.subtype ?? widget.widgetSubType,
        };

        const widgetTypeKey = nextWidget.widgetType ?? 'Unknown';
        widgetTypeCounts.set(widgetTypeKey, (widgetTypeCounts.get(widgetTypeKey) ?? 0) + 1);
        if (nextWidget.widgetType) resolvedWidgetTypes += 1;

        if (normalizeWidgetType(nextWidget.widgetType) === normalizedFocusWidgetType) {
          const ownerId = resolved?.ownerId ?? resolved?.userId ?? null;
          const ownerInfo = ownerId ? usersById.get(ownerId) : undefined;
          focusWidgetDetails.push({
            dashboardId: dashboard.dashboardId,
            dashboardTitle: dashboard.title,
            widgetId: nextWidget.widgetId,
            widgetName: nextWidget.widgetName,
            widgetType: nextWidget.widgetType ?? 'tablewidgetagg',
            widgetSubType: nextWidget.widgetSubType,
            ownerId,
            ownerName: ownerInfo?.ownerName ?? null,
            ownerEmail: ownerInfo?.ownerEmail ?? null,
            tenantId: ownerInfo?.tenantId ?? null,
            datasourceTitle: resolved?.datasourceTitle ?? null,
            datasourceFullname: resolved?.datasourceFullname ?? null,
            datasourceDatabase: resolved?.datasourceDatabase ?? null,
            datasourceAddress: resolved?.datasourceAddress ?? null,
          });
        }

        if (focusFunction && resolved?.rawPayload !== undefined) {
          const functionMatches = findFunctionMatches(resolved.rawPayload, focusFunction).slice(0, FUNCTION_MATCH_PREVIEW_LIMIT);
          if (functionMatches.length > 0) {
            const ownerId = resolved.ownerId ?? resolved.userId ?? null;
            const ownerInfo = ownerId ? usersById.get(ownerId) : undefined;
            focusFunctionDetails.push({
              dashboardId: dashboard.dashboardId,
              dashboardTitle: dashboard.title,
              widgetId: nextWidget.widgetId,
              widgetName: nextWidget.widgetName,
              widgetType: nextWidget.widgetType ?? 'Unknown',
              widgetSubType: nextWidget.widgetSubType,
              ownerId,
              ownerName: ownerInfo?.ownerName ?? null,
              ownerEmail: ownerInfo?.ownerEmail ?? null,
              tenantId: ownerInfo?.tenantId ?? null,
              datasourceTitle: resolved.datasourceTitle ?? null,
              datasourceDatabase: resolved.datasourceDatabase ?? null,
              datasourceAddress: resolved.datasourceAddress ?? null,
              matches: functionMatches,
            });
          }
        }

        if (returnedWidgetRefs >= maxWidgets) {
          truncated = true;
          continue;
        }

        widgets.push(nextWidget);
        returnedWidgetRefs += 1;
      }

      output.push({
        dashboardId: dashboard.dashboardId,
        title: dashboard.title,
        widgets,
      });
    }

    const widgetTypeBreakdown = Array.from(widgetTypeCounts.entries())
      .map(([widgetType, count]) => ({ widgetType, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      data: {
        summary: {
          totalUsers,
          totalDashboards: output.length,
          totalWidgets: totalWidgetRefs,
          dashboards: output.length,
          totalWidgetRefs,
          returnedWidgetRefs,
          maxWidgets,
          truncated,
          resolvedWidgetTypes,
          dashboardWidgetCalls,
          dashboardWidgetCallErrors,
          focusWidgetType,
          focusWidgetCount: focusWidgetDetails.length,
          focusFunction,
          focusFunctionCount: focusFunctionDetails.length,
          focusUserQuery,
          focusUserCount: 0,
        },
        widgetTypeBreakdown,
        focusWidgetDetails,
        focusFunctionDetails,
        focusUserDetails: [],
        dashboards: output,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
