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

interface JaqlMetadataItem extends Record<string, unknown> {
  panel?: string;
  disabled?: boolean;
  field?: Record<string, unknown>;
  jaql?: Record<string, unknown>;
}

type JaqlApiPayload = {
  values?: unknown[];
  data?: { values?: unknown[] };
  details?: unknown;
  extraDetails?: unknown;
  type?: unknown;
  subType?: unknown;
  error?: { message?: string };
};

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

const normalizeDatasourceForBody = (fullname: string): { fullname: string } => ({
  fullname: fullname.startsWith('localhost/') ? fullname : `localhost/${fullname}`,
});

const normalizeJaqlMetadata = (
  metadata: Array<Record<string, unknown>>,
  datasource: { fullname: string }
): JaqlMetadataItem[] =>
  metadata.map((item, index) => {
    const mapped: JaqlMetadataItem = { ...item };

    if (mapped.disabled) return mapped;

    if (mapped.panel === 'categories') mapped.panel = 'rows';

    if (mapped.panel !== 'scope') {
      const existingField = isRecord(mapped.field) ? mapped.field : {};
      mapped.field = {
        ...existingField,
        index,
        id: isRecord(mapped.jaql) ? mapped.jaql.dim ?? existingField.id : existingField.id,
      };
    }

    if (mapped.panel === 'rows' && isRecord(mapped.jaql)) {
      mapped.jaql = {
        ...mapped.jaql,
        pv: {
          'Visible in View>Yes': 2,
          'Aggregation>Count': 2,
        },
      };
    }

    if (mapped.panel === 'scope' && isRecord(mapped.jaql) && !mapped.jaql.datasource) {
      mapped.jaql = {
        ...mapped.jaql,
        datasource,
      };
    }

    return mapped;
  });

const findUnsupportedFormulaItems = (metadata: JaqlMetadataItem[]) =>
  metadata.filter(
    (item) =>
      item.panel === 'scope' &&
      isRecord(item.jaql) &&
      item.jaql.type === 'measure' &&
      typeof item.jaql.formula === 'string'
  );

const removeUnsupportedFormulaItems = (metadata: JaqlMetadataItem[]) =>
  metadata.filter(
    (item) =>
      !(
        item.panel === 'scope' &&
        isRecord(item.jaql) &&
        item.jaql.type === 'measure' &&
        typeof item.jaql.formula === 'string'
      )
  );

const getValuesFromJaqlPayload = (payload: JaqlApiPayload): unknown[] =>
  Array.isArray(payload.values)
    ? payload.values
    : Array.isArray(payload.data?.values)
      ? payload.data.values
      : [];

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

    const normalizedDatasource = normalizeDatasourceForBody(datasourceFullname);
    const datasourceId = datasourceFullname.includes('/')
      ? datasourceFullname.split('/').pop() ?? datasourceFullname
      : datasourceFullname;

    const normalizedMetadata = normalizeJaqlMetadata(widget.query.metadata, normalizedDatasource);
    const runJaql = async (metadata: JaqlMetadataItem[]) => {
      const jaqlResponse = await fetch(`${baseUrl}/api/datasources/${encodeURIComponent(datasourceId)}/jaql`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          datasource: normalizedDatasource,
          metadata,
          count: widget.query.count ?? 1000,
        }),
        cache: 'no-store',
      });

      const payload = (await jaqlResponse.json()) as JaqlApiPayload;
      return { jaqlResponse, payload };
    };

    let { jaqlResponse, payload } = await runJaql(normalizedMetadata);
    let warning: string | undefined;

    if (typeof payload.subType === 'string' && payload.subType === 'formulaNotSupported') {
      const unsupportedFormulas = findUnsupportedFormulaItems(normalizedMetadata).map((item) => ({
        title:
          isRecord(item.jaql) && typeof item.jaql.title === 'string'
            ? item.jaql.title
            : 'Formula',
        formula:
          isRecord(item.jaql) && typeof item.jaql.formula === 'string'
            ? item.jaql.formula
            : '',
      }));

      const retryMetadata = removeUnsupportedFormulaItems(normalizedMetadata);
      if (retryMetadata.length < normalizedMetadata.length) {
        const retryResult = await runJaql(retryMetadata);
        if (retryResult.jaqlResponse.ok) {
          jaqlResponse = retryResult.jaqlResponse;
          payload = retryResult.payload;
          warning =
            'Some filters were not applied because Sisense breaks on this formula-based filter during live load. Broader live data was loaded after removing the unsupported formula filter. For more clarification, please ask Buddha.';
        } else {
          return NextResponse.json(
            {
              error:
                'This live widget uses a formula-based filter that Sisense does not support in the JAQL API. Please use the exported file for comparison.',
              unsupportedFormulas,
            },
            { status: 400 }
          );
        }
      } else {
        return NextResponse.json(
          {
            error:
              'This live widget uses a formula-based filter that Sisense does not support in the JAQL API. Please use the exported file for comparison.',
            unsupportedFormulas,
          },
          { status: 400 }
        );
      }
    }
    if (!jaqlResponse.ok) {
      return NextResponse.json(
        { error: payload.error?.message ?? 'Failed to execute widget data query.' },
        { status: jaqlResponse.status }
      );
    }

    const values = getValuesFromJaqlPayload(payload);

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

    return NextResponse.json({ workbook, workbookData, warning });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
