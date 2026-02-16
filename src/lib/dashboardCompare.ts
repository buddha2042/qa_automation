import { normalizeBaseUrl, sanitizeBearerToken } from '@/lib/network';

interface SisenseWidget {
  type?: string;
  subtype?: string;
  query?: {
    datasource?: {
      fullname?: string;
    };
    metadata?: Array<Record<string, unknown>>;
    count?: number;
  };
  metadata?: {
    panels?: Array<{
      name?: string;
      items?: Array<{
        jaql?: unknown;
        disabled?: boolean;
      }>;
    }>;
  };
  datasource?: {
    fullname?: string;
  };
  sort?: unknown;
  top?: unknown;
  drilldown?: unknown;
  series?: unknown;
  xAxis?: unknown;
  yAxis?: unknown;
  breakBy?: unknown;
  style?: unknown;
  color?: unknown;
  conditionalFormatting?: unknown;
  enabled?: boolean;
  visible?: boolean;
}

export interface DashboardCompareCredentials {
  regular: { url: string; token: string };
  refactor: { url: string; token: string };
}

export interface CompareSingleWidgetInput {
  regularDashboardId: string;
  refactorDashboardId: string;
  widgetId: string;
}

type WidgetCompareStatus = 'MATCH' | 'MISMATCH' | 'ERROR';

interface PreviewJaqlMetadataItem {
  panel?: string;
  disabled?: boolean;
  instanceid?: string;
  jaql?: {
    title?: string;
    dim?: string;
    formula?: string;
    datasource?: {
      fullname?: string;
    };
    pv?: Record<string, number>;
  };
  field?: {
    index?: number;
    id?: string;
  };
}

interface PreviewJaqlBody {
  datasource: {
    fullname: string;
  };
  count: number;
  metadata: PreviewJaqlMetadataItem[];
}

export interface WidgetFieldComparisonRow {
  path: string;
  status: 'MATCH' | 'MISMATCH';
  regularValue: string;
  refactorValue: string;
}

export interface WidgetOutputCompareRow {
  status: 'MATCH' | 'MISMATCH';
  legacyRowKey: string;
  refactorRowKey: string;
  legacyValues: string[];
  refactorValues: string[];
}

export interface WidgetOutputCompareData {
  legacyHeaders: string[];
  refactorHeaders: string[];
  legacyRows: string[][];
  refactorRows: string[][];
  rows: WidgetOutputCompareRow[];
  mismatchRowCount: number;
}

export interface CompareSingleWidgetResult extends WidgetCompareResultItem {
  comparisons: WidgetFieldComparisonRow[];
  outputCompare?: WidgetOutputCompareData;
}

interface WidgetCompareResultItem {
  widgetId: string;
  status: WidgetCompareStatus;
  diffCount: number;
  reason?: string;
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const toDisplayValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const collectFieldComparisons = (
  left: unknown,
  right: unknown,
  path: string
): WidgetFieldComparisonRow[] => {
  const leftObject = left && typeof left === 'object';
  const rightObject = right && typeof right === 'object';

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length === 0 && right.length === 0) {
      return [
        {
          path,
          status: 'MATCH',
          regularValue: '[]',
          refactorValue: '[]',
        },
      ];
    }

    const maxLen = Math.max(left.length, right.length);
    const rows: WidgetFieldComparisonRow[] = [];
    for (let i = 0; i < maxLen; i += 1) {
      rows.push(...collectFieldComparisons(left[i], right[i], `${path}[${i}]`));
    }
    return rows;
  }

  if (
    leftObject &&
    rightObject &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const l = left as Record<string, unknown>;
    const r = right as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(l), ...Object.keys(r)])).sort();

    if (keys.length === 0) {
      return [
        {
          path,
          status: 'MATCH',
          regularValue: '{}',
          refactorValue: '{}',
        },
      ];
    }

    const rows: WidgetFieldComparisonRow[] = [];
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      rows.push(...collectFieldComparisons(l[key], r[key], nextPath));
    }
    return rows;
  }

  const status =
    stableStringify(left) === stableStringify(right) ? 'MATCH' : 'MISMATCH';
  return [
    {
      path,
      status,
      regularValue: toDisplayValue(left),
      refactorValue: toDisplayValue(right),
    },
  ];
};

const csvRowKey = (row: string[]): string => JSON.stringify(row.map((cell) => cell ?? ''));

const maxColumnCount = (rows: string[][]): number =>
  rows.reduce((max, row) => Math.max(max, row.length), 0);

const buildDynamicHeaders = (
  headers: string[],
  rows: string[][],
  fallbackPrefix: string
): string[] => {
  const count = Math.max(headers.length, maxColumnCount(rows), 1);
  return Array.from({ length: count }, (_, i) => headers[i] ?? `${fallbackPrefix} ${i + 1}`);
};

const normalizePreviewRows = (values: unknown, expectedColumns: number): string[][] => {
  if (!Array.isArray(values)) return [];

  return values.map((row) => {
    const arr = Array.isArray(row) ? row : [row];
    const normalized = arr.slice(0, expectedColumns).map((cell) => {
      if (cell && typeof cell === 'object') {
        const obj = cell as { text?: unknown; data?: unknown };
        if (typeof obj.text === 'string') return obj.text.trim();
        if (obj.data !== undefined && obj.data !== null) return String(obj.data).trim();
      }
      if (cell === null || cell === undefined) return '';
      return String(cell).trim();
    });

    while (normalized.length < expectedColumns) normalized.push('');
    return normalized;
  });
};

const jaqlLabel = (item: PreviewJaqlMetadataItem): string =>
  item.jaql?.title || item.jaql?.dim || item.jaql?.formula || 'Unnamed';

const getPanelItems = (widget: SisenseWidget, panelName: string): PreviewJaqlMetadataItem[] =>
  (widget.metadata?.panels ?? [])
    .filter((panel) => panel.name === panelName)
    .flatMap((panel) =>
      (panel.items ?? []).map((item) => ({
        panel: panel.name,
        disabled: item.disabled,
        jaql:
          item.jaql && typeof item.jaql === 'object'
            ? (item.jaql as PreviewJaqlMetadataItem['jaql'])
            : undefined,
      }))
    );

const buildPreviewHeaders = (widget: SisenseWidget, rows: string[][], side: 'Legacy' | 'Refactor'): string[] => {
  const rowItems = getPanelItems(widget, 'rows').filter((item) => !item.disabled);
  const valueItems = getPanelItems(widget, 'values').filter((item) => !item.disabled);
  const preferred = [...rowItems.map(jaqlLabel), ...valueItems.map(jaqlLabel)];
  return buildDynamicHeaders(preferred, rows, `${side} Col`);
};

const getExpectedPreviewColumns = (widget: SisenseWidget): number => {
  const rowCount = getPanelItems(widget, 'rows').filter((item) => !item.disabled).length;
  const valueCount = getPanelItems(widget, 'values').filter((item) => !item.disabled).length;
  const total = rowCount + valueCount;
  return total > 0 ? total : 1;
};

const normalizeDatasourceForBody = (fullname: string): { fullname: string } => ({
  fullname: fullname.startsWith('localhost/') ? fullname : `localhost/${fullname}`,
});

const readDatasourceId = (fullname: string): string =>
  fullname.includes('/') ? fullname.split('/').pop() ?? fullname : fullname;

const buildPreviewJaqlBody = (widget: SisenseWidget): PreviewJaqlBody | null => {
  const metadata = (widget.metadata?.panels ?? []).flatMap((panel) =>
    (panel.items ?? []).map((item, index) => {
      const panelName = panel.name;
      const jaql =
        item.jaql && typeof item.jaql === 'object'
          ? ({ ...(item.jaql as PreviewJaqlMetadataItem['jaql']) } as PreviewJaqlMetadataItem['jaql'])
          : undefined;

      const mapped: PreviewJaqlMetadataItem = {
        panel: panelName === 'categories' ? 'rows' : panelName,
        disabled: item.disabled ?? false,
        jaql,
      };

      if (!mapped.disabled && mapped.panel !== 'scope') {
        mapped.field = {
          index,
          id: mapped.jaql?.dim,
        };
      }

      if (!mapped.disabled && mapped.panel === 'rows' && mapped.jaql) {
        mapped.jaql = {
          ...mapped.jaql,
          pv: {
            'Visible in View>Yes': 2,
            'Aggregation>Count': 2,
          },
        };
      }

      return mapped;
    })
  );

  const filtered = metadata.filter((item) => item.jaql && !item.disabled);
  if (filtered.length === 0) return null;

  const datasourceFullname =
    widget.query?.datasource?.fullname?.trim() ||
    widget.datasource?.fullname?.trim() ||
    filtered.find((item) => item.jaql?.datasource?.fullname)?.jaql?.datasource?.fullname?.trim() ||
    '';

  if (!datasourceFullname) return null;

  const datasource = normalizeDatasourceForBody(datasourceFullname);
  return {
    datasource,
    count: 1000,
    metadata: filtered.map((item) => {
      if (item.panel === 'scope' && item.jaql && !item.jaql.datasource) {
        return {
          ...item,
          jaql: {
            ...item.jaql,
            datasource,
          },
        };
      }
      return item;
    }),
  };
};

const fetchPreviewRows = async (
  baseUrl: string,
  token: string,
  widget: SisenseWidget
): Promise<string[][]> => {
  const postJaqlAndReadRows = async (body: PreviewJaqlBody) => {
    const datasourceId = readDatasourceId(body.datasource.fullname);
    const response = await fetch(
      `${baseUrl}/api/datasources/${encodeURIComponent(datasourceId)}/jaql`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sanitizeBearerToken(token)}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      }
    );

    const raw = (await response.json()) as {
      values?: unknown[];
      data?: { values?: unknown[] };
      error?: { message?: string };
      message?: string;
    };

    if (!response.ok) {
      throw new Error(raw.error?.message ?? raw.message ?? `Preview JAQL failed (${response.status})`);
    }

    const values = Array.isArray(raw.values)
      ? raw.values
      : Array.isArray(raw.data?.values)
        ? raw.data.values
        : [];

    return normalizePreviewRows(values, getExpectedPreviewColumns(widget));
  };

  const queryDatasource =
    widget.query?.datasource?.fullname?.trim() ||
    widget.datasource?.fullname?.trim() ||
    '';
  const queryMetadata = Array.isArray(widget.query?.metadata) ? widget.query?.metadata : [];

  if (queryDatasource && queryMetadata.length > 0) {
    const fullQueryBody: PreviewJaqlBody = {
      datasource: normalizeDatasourceForBody(queryDatasource),
      metadata: queryMetadata as PreviewJaqlMetadataItem[],
      count: widget.query?.count ?? 1000,
    };
    return postJaqlAndReadRows(fullQueryBody);
  }

  const jaqlBody = buildPreviewJaqlBody(widget);
  if (!jaqlBody) return [];
  return postJaqlAndReadRows(jaqlBody);
};

const compareOutputRows = (
  legacyRows: string[][],
  refactorRows: string[][],
  legacyHeaders: string[],
  refactorHeaders: string[]
): WidgetOutputCompareData => {
  const refMap = new Map<string, string[][]>();
  for (const row of refactorRows) {
    const key = csvRowKey(row);
    const bucket = refMap.get(key) ?? [];
    bucket.push(row);
    refMap.set(key, bucket);
  }

  const paired: WidgetOutputCompareRow[] = [];

  for (const legacyRow of legacyRows) {
    const key = csvRowKey(legacyRow);
    const bucket = refMap.get(key);
    if (bucket && bucket.length > 0) {
      const matchedRef = bucket.shift() as string[];
      paired.push({
        status: 'MATCH',
        legacyRowKey: key,
        refactorRowKey: csvRowKey(matchedRef),
        legacyValues: legacyRow,
        refactorValues: matchedRef,
      });
    } else {
      paired.push({
        status: 'MISMATCH',
        legacyRowKey: key,
        refactorRowKey: '',
        legacyValues: legacyRow,
        refactorValues: [],
      });
    }
  }

  for (const rows of refMap.values()) {
    for (const refRow of rows) {
      paired.push({
        status: 'MISMATCH',
        legacyRowKey: '',
        refactorRowKey: csvRowKey(refRow),
        legacyValues: [],
        refactorValues: refRow,
      });
    }
  }

  return {
    legacyHeaders,
    refactorHeaders,
    legacyRows,
    refactorRows,
    rows: paired,
    mismatchRowCount: paired.filter((row) => row.status === 'MISMATCH').length,
  };
};

const extractComparableWidget = (widget: SisenseWidget) => {
  const query = widget.query ?? {};
  const metadata = widget.metadata ?? {};
  const panels = metadata.panels ?? [];

  return {
    widgetType: widget.type ?? null,
    widgetSubType: widget.subtype ?? null,
    datasource: {
      fullname: query.datasource?.fullname ?? widget.datasource?.fullname ?? null,
    },
    panels: panels.map((p) => ({
      name: p.name,
      items: (p.items ?? []).map((i) => ({
        jaql: i.jaql,
        disabled: i.disabled ?? false,
      })),
    })),
    sort: widget.sort ?? null,
    top: widget.top ?? null,
    drilldown: widget.drilldown ?? null,
    series: widget.series ?? null,
    xAxis: widget.xAxis ?? null,
    yAxis: widget.yAxis ?? null,
    breakBy: widget.breakBy ?? null,
    style: widget.style ?? null,
    color: widget.color ?? null,
    conditionalFormatting: widget.conditionalFormatting ?? null,
    enabled: widget.enabled ?? true,
    visible: widget.visible ?? true,
  };
};

const fetchComparableWidget = async (
  baseUrl: string,
  token: string,
  dashboardId: string,
  widgetId: string
) => {
  const url = `${baseUrl}/api/v1/dashboards/${encodeURIComponent(dashboardId)}/widgets/${encodeURIComponent(widgetId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${sanitizeBearerToken(token)}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Widget fetch failed (${response.status}): ${text}`);
  }

  const widget = (await response.json()) as SisenseWidget;
  return {
    raw: widget,
    comparable: extractComparableWidget(widget),
  };
};

export async function compareSingleWidget(
  credentials: DashboardCompareCredentials,
  input: CompareSingleWidgetInput
): Promise<CompareSingleWidgetResult> {
  const regularBase = normalizeBaseUrl(credentials.regular.url);
  const refactorBase = normalizeBaseUrl(credentials.refactor.url);

  try {
    const [regularWidget, refactorWidget] = await Promise.all([
      fetchComparableWidget(
        regularBase,
        credentials.regular.token,
        input.regularDashboardId,
        input.widgetId
      ),
      fetchComparableWidget(
        refactorBase,
        credentials.refactor.token,
        input.refactorDashboardId,
        input.widgetId
      ),
    ]);

    const comparisons = collectFieldComparisons(
      regularWidget.comparable,
      refactorWidget.comparable,
      'widget'
    );
    const structuralDiffCount = comparisons.filter((row) => row.status === 'MISMATCH').length;

    let outputCompare: WidgetOutputCompareData | undefined;
    try {
      const [legacyRows, refRows] = await Promise.all([
        fetchPreviewRows(regularBase, credentials.regular.token, regularWidget.raw),
        fetchPreviewRows(refactorBase, credentials.refactor.token, refactorWidget.raw),
      ]);

      const legacyHeaders = buildPreviewHeaders(regularWidget.raw, legacyRows, 'Legacy');
      const refactorHeaders = buildPreviewHeaders(refactorWidget.raw, refRows, 'Refactor');
      outputCompare = compareOutputRows(legacyRows, refRows, legacyHeaders, refactorHeaders);
    } catch {
      outputCompare = undefined;
    }

    const diffCount = structuralDiffCount;
    return {
      widgetId: input.widgetId,
      status: diffCount === 0 ? 'MATCH' : 'MISMATCH',
      diffCount,
      comparisons,
      outputCompare,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown widget compare error';
    return {
      widgetId: input.widgetId,
      status: 'ERROR',
      diffCount: 0,
      reason,
      comparisons: [],
    };
  }
}
