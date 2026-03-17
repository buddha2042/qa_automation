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
}

interface RawDashboard {
  oid?: string;
  _id?: string;
  title?: string;
  name?: string;
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
}

interface RawUser {
  _id?: string;
  userName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  tenantId?: string;
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
    const normalizedFocusWidgetType = normalizeWidgetType(focusWidgetType);

    const [usersResponse, adminResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/users`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }),
      fetch(`${baseUrl}/api/v1/dashboards/admin`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }),
    ]);

    const usersContentType = usersResponse.headers.get('content-type') ?? '';
    const usersPayload = usersContentType.includes('application/json')
      ? ((await usersResponse.json()) as unknown)
      : (await usersResponse.text());

    if (!usersResponse.ok) {
      const message = typeof usersPayload === 'string' ? usersPayload : JSON.stringify(usersPayload);
      return NextResponse.json({ error: `Sisense users responded with ${usersResponse.status}: ${message}` }, { status: usersResponse.status });
    }

    const adminContentType = adminResponse.headers.get('content-type') ?? '';
    const adminPayload = adminContentType.includes('application/json')
      ? ((await adminResponse.json()) as unknown)
      : (await adminResponse.text());

    if (!adminResponse.ok) {
      const message = typeof adminPayload === 'string' ? adminPayload : JSON.stringify(adminPayload);
      return NextResponse.json({ error: `Sisense dashboards responded with ${adminResponse.status}: ${message}` }, { status: adminResponse.status });
    }

    const maxWidgets = Math.min(MAX_WIDGETS_HARD, Math.max(1, Number(body.maxWidgets) || MAX_WIDGETS_DEFAULT));
    const users = parseUsers(usersPayload);
    const totalUsers = users.length;
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

    const baseRows: OutputDashboard[] = dashboards
      .map((dashboard) => {
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
        },
        widgetTypeBreakdown,
        focusWidgetDetails,
        focusFunctionDetails,
        dashboards: output,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
