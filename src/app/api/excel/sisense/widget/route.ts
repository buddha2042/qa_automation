import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer } from '@/lib/sisenseAuth';
import type { WorkbookData, WorkbookSummary } from '@/lib/excelAudit';

export const runtime = 'nodejs';

interface WidgetPanelItem {
  jaql?: unknown;
  disabled?: boolean;
}

interface WidgetPanel {
  name?: string;
  items?: WidgetPanelItem[];
}

interface SisenseWidget {
  query?: {
    datasource?: { fullname?: string };
    metadata?: Array<Record<string, unknown>>;
    count?: number;
  };
  metadata?: {
    panels?: WidgetPanel[];
  };
  datasource?: { fullname?: string };
}

interface WidgetRequestBody {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  dashboardId?: string;
  widgetId?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cellToText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isRecord(value)) {
    if (typeof value.text === 'string') return value.text;
    if (value.data !== undefined && value.data !== null) return String(value.data);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const prepareComparableWidget = (widget: SisenseWidget) => {
  const query = widget.query ?? {};
  const metadata = widget.metadata?.panels ?? [];

  return {
    datasource: {
      fullname: query.datasource?.fullname ?? widget.datasource?.fullname ?? null,
    },
    query: {
      datasource: {
        fullname: query.datasource?.fullname ?? widget.datasource?.fullname ?? null,
      },
      metadata: query.metadata ?? [],
      count: query.count ?? 1000,
    },
    panels: metadata.map((panel) => ({
      name: panel.name,
      items: (panel.items ?? []).map((item) => ({
        jaql: item.jaql,
        disabled: item.disabled ?? false,
      })),
    })),
  };
};

const jaqlLabel = (item: WidgetPanelItem): string => {
  if (!isRecord(item.jaql)) return '';
  const title = item.jaql.title;
  const dim = item.jaql.dim;
  if (typeof title === 'string' && title.trim()) return title.trim();
  if (typeof dim === 'string' && dim.trim()) return dim.trim();
  return '';
};

const buildHeaders = (widget: ReturnType<typeof prepareComparableWidget>): string[] => {
  const orderedPanelNames = ['rows', 'columns', 'values', 'breakBy', 'series', 'categories'];
  const panelMap = new Map<string, string[]>();

  for (const panel of widget.panels) {
    const labels = (panel.items ?? [])
      .filter((item) => !item.disabled)
      .map(jaqlLabel)
      .filter(Boolean);
    panelMap.set(panel.name ?? 'unknown', labels);
  }

  const ordered = orderedPanelNames.flatMap((name) => panelMap.get(name) ?? []);
  const rest = Array.from(panelMap.entries())
    .filter(([name]) => !orderedPanelNames.includes(name))
    .flatMap(([, labels]) => labels);

  const combined = [...ordered, ...rest];
  return combined.length > 0 ? combined : ['Column 1'];
};

const normalizeRows = (values: unknown[], headers: string[]): string[][] =>
  values.map((row) => {
    const cells = Array.isArray(row) ? row : [row];
    const normalized = headers.map((_, index) => cellToText(cells[index]));
    return normalized;
  });

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WidgetRequestBody;
    if (!body.baseUrl || !body.dashboardId || !body.widgetId || !hasSisenseAuth(body)) {
      return NextResponse.json({ error: 'Sisense URL, credentials, dashboard, and widget are required.' }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const token = await resolveSisenseBearer(baseUrl, body);

    const widgetResponse = await fetch(
      `${baseUrl}/api/v1/dashboards/${encodeURIComponent(body.dashboardId)}/widgets/${encodeURIComponent(body.widgetId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (!widgetResponse.ok) {
      const errorText = await widgetResponse.text();
      return NextResponse.json({ error: `Failed to fetch widget: ${errorText}` }, { status: widgetResponse.status });
    }

    const widget = prepareComparableWidget((await widgetResponse.json()) as SisenseWidget);
    const datasourceFullname =
      widget.query.datasource.fullname?.trim() || widget.datasource.fullname?.trim() || '';

    if (!datasourceFullname || !Array.isArray(widget.query.metadata) || widget.query.metadata.length === 0) {
      return NextResponse.json({ error: 'Selected widget does not expose queryable metadata.' }, { status: 400 });
    }

    const datasourceId = datasourceFullname.includes('/')
      ? datasourceFullname.split('/').pop() ?? datasourceFullname
      : datasourceFullname;

    const jaqlResponse = await fetch(`${baseUrl}/api/datasources/${encodeURIComponent(datasourceId)}/jaql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        datasource: {
          fullname: datasourceFullname.startsWith('localhost/')
            ? datasourceFullname
            : `localhost/${datasourceFullname}`,
        },
        metadata: widget.query.metadata,
        count: widget.query.count ?? 1000,
      }),
      cache: 'no-store',
    });

    const payload = (await jaqlResponse.json()) as { values?: unknown[]; data?: { values?: unknown[] }; error?: { message?: string } };
    if (!jaqlResponse.ok) {
      return NextResponse.json(
        { error: payload.error?.message ?? 'Failed to execute widget data query.' },
        { status: jaqlResponse.status }
      );
    }

    const values = Array.isArray(payload.values)
      ? payload.values
      : Array.isArray(payload.data?.values)
        ? payload.data.values
        : [];

    const headers = buildHeaders(widget);
    const rows = normalizeRows(values, headers);
    const sheetName = `${body.dashboardId}:${body.widgetId}`;
    const workbookData: WorkbookData = {
      [sheetName]: [headers, ...rows],
    };
    const workbook: WorkbookSummary = {
      sheets: [
        {
          name: sheetName,
          inferredHeaderRow: 1,
          headers,
          rowCount: rows.length,
          columnCount: headers.length,
          sampleRows: rows.slice(0, 5),
          previewRows: rows,
        },
      ],
    };

    return NextResponse.json({ workbook, workbookData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
