import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer } from '@/lib/sisenseAuth';

export const runtime = 'nodejs';

interface InventoryRequestBody {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
}

interface SisenseDashboard {
  oid?: string;
  _id?: string;
  id?: string;
  title?: string;
  name?: string;
  widgets?: Array<string | { oid?: string; _id?: string; id?: string; widgetId?: string; widgetid?: string }>;
  layout?: {
    columns?: Array<{
      cells?: Array<{
        subcells?: Array<{
          elements?: Array<{
            widgetid?: string;
            widgetId?: string;
            title?: string;
            name?: string;
          }>;
        }>;
      }>;
    }>;
  };
}

interface SisenseWidgetDetail {
  title?: string;
  name?: string;
}

const WIDGET_ENDPOINT_CONCURRENCY = 10;
const WIDGET_NAME_PRIORITY_KEYS = [
  'title',
  'name',
  'caption',
  'widgetTitle',
  'widgetName',
  'displayName',
  'header',
  'label',
] as const;

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

const parseDashboards = (payload: unknown): SisenseDashboard[] => {
  if (Array.isArray(payload)) return payload as SisenseDashboard[];
  const obj = asRecord(payload);
  if (!obj) return [];

  const candidates = [obj.dashboards, obj.data, obj.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as SisenseDashboard[];
  }

  return [];
};

const readNestedCandidate = (record: Record<string, unknown>, path: string[]): string => {
  let current: unknown = record;

  for (const segment of path) {
    const next = asRecord(current);
    if (!next || !(segment in next)) return '';
    current = next[segment];
  }

  return typeof current === 'string' ? current.trim() : '';
};

const extractWidgetDisplayName = (payload: unknown): string => {
  const visited = new Set<unknown>();

  const walk = (value: unknown): string => {
    if (!value || typeof value !== 'object') return '';
    if (visited.has(value)) return '';
    visited.add(value);

    const record = asRecord(value);
    if (!record) return '';

    for (const key of WIDGET_NAME_PRIORITY_KEYS) {
      const candidate = typeof record[key] === 'string' ? record[key].trim() : '';
      if (candidate) return candidate;
    }

    const nestedPriorityPaths = [
      ['widget'],
      ['widget', 'header'],
      ['widget', 'metadata'],
      ['widget', 'style'],
      ['metadata'],
      ['metadata', 'header'],
      ['metadata', 'widget'],
      ['metadata', 'panel'],
      ['style'],
      ['style', 'header'],
    ];

    for (const path of nestedPriorityPaths) {
      const candidate = readNestedCandidate(record, path);
      if (candidate) return candidate;

      let current: unknown = record;
      for (const segment of path) {
        const next = asRecord(current);
        if (!next || !(segment in next)) {
          current = null;
          break;
        }
        current = next[segment];
      }

      const nestedResult = walk(current);
      if (nestedResult) return nestedResult;
    }

    for (const nested of Object.values(record)) {
      const candidate = walk(nested);
      if (candidate) return candidate;
    }

    return '';
  };

  return walk(payload);
};

function extractWidgetMeta(dashboard: SisenseDashboard) {
  const ids = new Set<string>();
  const titles: Record<string, string> = {};

  for (const widgetRef of dashboard.widgets ?? []) {
    const widgetId = normalizeId(widgetRef);
    if (widgetId) ids.add(widgetId);
  }

  for (const column of dashboard.layout?.columns ?? []) {
    for (const cell of column.cells ?? []) {
      for (const subcell of cell.subcells ?? []) {
        for (const element of subcell.elements ?? []) {
          const widgetId = normalizeId(element);
          if (!widgetId) continue;
          ids.add(widgetId);
          const candidate = typeof element.title === 'string' ? element.title : element.name;
          if (candidate?.trim()) {
            titles[widgetId] = candidate.trim();
          }
        }
      }
    }
  }

  return { ids: Array.from(ids), titles };
}

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

type InventoryDashboard = {
  dashboardId: string;
  title: string;
  widgets: Array<{
    widgetId: string;
    title: string;
  }>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InventoryRequestBody;
    if (!body.baseUrl || !hasSisenseAuth(body)) {
      return NextResponse.json({ error: 'Sisense URL and credentials are required.' }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const token = await resolveSisenseBearer(baseUrl, body);
    const response = await fetch(`${baseUrl}/api/v1/dashboards`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? ((await response.json()) as unknown)
      : (await response.text());

    if (!response.ok) {
      const errorText = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return NextResponse.json({ error: `Sisense responded with ${response.status}: ${errorText}` }, { status: response.status });
    }

    const dashboards = parseDashboards(payload);
    const baseData = dashboards.map((dashboard) => {
      const dashboardId = normalizeId(dashboard);
      const dashboardTitle = String(dashboard.title ?? dashboard.name ?? dashboardId).trim();
      const widgets = extractWidgetMeta(dashboard);

      return {
        dashboardId,
        title: dashboardTitle,
        widgets: widgets.ids.map((widgetId) => ({
          widgetId,
          title: widgets.titles[widgetId] ?? '',
        })),
      };
    }).filter((dashboard) => dashboard.dashboardId);

    const mergedDashboards = new Map<string, InventoryDashboard>();
    for (const dashboard of baseData) {
      const existing = mergedDashboards.get(dashboard.dashboardId);
      if (!existing) {
        mergedDashboards.set(dashboard.dashboardId, {
          dashboardId: dashboard.dashboardId,
          title: dashboard.title,
          widgets: [...dashboard.widgets],
        });
        continue;
      }

      if (!existing.title.trim() && dashboard.title.trim()) {
        existing.title = dashboard.title;
      }

      const widgetMap = new Map(existing.widgets.map((widget) => [widget.widgetId, widget]));
      for (const widget of dashboard.widgets) {
        const existingWidget = widgetMap.get(widget.widgetId);
        if (!existingWidget) {
          existing.widgets.push(widget);
          widgetMap.set(widget.widgetId, widget);
          continue;
        }

        if (!existingWidget.title.trim() && widget.title.trim()) {
          existingWidget.title = widget.title;
        }
      }
    }

    const dedupedBaseData = Array.from(mergedDashboards.values());

    const widgetTitles = new Map<string, string>();
    const widgetDetailTasks: Array<() => Promise<void>> = [];

    for (const dashboard of dedupedBaseData) {
      for (const widget of dashboard.widgets) {
        if (widget.title.trim()) continue;

        widgetDetailTasks.push(async () => {
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

            if (!widgetResponse.ok) return;

            const widgetContentType = widgetResponse.headers.get('content-type') ?? '';
            const widgetPayload = widgetContentType.includes('application/json')
              ? ((await widgetResponse.json()) as SisenseWidgetDetail | Record<string, unknown>)
              : null;

            const widgetTitle = extractWidgetDisplayName(widgetPayload);
            if (widgetTitle) {
              widgetTitles.set(`${dashboard.dashboardId}::${widget.widgetId}`, widgetTitle);
            }
          } catch {
            // Ignore individual widget lookup failures and keep the ID fallback.
          }
        });
      }
    }

    await runWithConcurrency(widgetDetailTasks, WIDGET_ENDPOINT_CONCURRENCY);

    const data = dedupedBaseData.map((dashboard) => ({
      ...dashboard,
      widgets: dashboard.widgets.map((widget) => ({
        ...widget,
        title: widgetTitles.get(`${dashboard.dashboardId}::${widget.widgetId}`) ?? widget.title,
      })),
    }));

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
