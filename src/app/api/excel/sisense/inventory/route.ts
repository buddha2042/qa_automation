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
  _id: string;
  title: string;
  layout?: {
    columns?: Array<{
      cells?: Array<{
        subcells?: Array<{
          elements?: Array<{
            widgetid?: string;
            title?: string;
            name?: string;
          }>;
        }>;
      }>;
    }>;
  };
}

function extractWidgetMeta(layout?: SisenseDashboard['layout']) {
  const ids = new Set<string>();
  const titles: Record<string, string> = {};
  if (!layout?.columns) return { ids: [], titles };

  for (const column of layout.columns) {
    for (const cell of column.cells ?? []) {
      for (const subcell of cell.subcells ?? []) {
        for (const element of subcell.elements ?? []) {
          if (!element.widgetid) continue;
          ids.add(element.widgetid);
          const candidate = typeof element.title === 'string' ? element.title : element.name;
          if (candidate?.trim()) {
            titles[element.widgetid] = candidate.trim();
          }
        }
      }
    }
  }

  return { ids: Array.from(ids), titles };
}

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
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Sisense responded with ${response.status}: ${errorText}` }, { status: response.status });
    }

    const dashboards = (await response.json()) as SisenseDashboard[];
    const data = dashboards.map((dashboard) => {
      const widgets = extractWidgetMeta(dashboard.layout);
      return {
        dashboardId: dashboard._id,
        title: dashboard.title,
        widgets: widgets.ids.map((widgetId) => ({
          widgetId,
          title: widgets.titles[widgetId] ?? widgetId,
        })),
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
