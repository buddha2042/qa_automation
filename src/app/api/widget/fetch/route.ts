import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer } from '@/lib/sisenseAuth';

interface WidgetPanelItem {
  jaql?: unknown;
  disabled?: boolean;
}

interface WidgetPanel {
  name?: string;
  items?: WidgetPanelItem[];
}

interface SisenseWidget {
  type?: string;
  subtype?: string;
  query?: {
    datasource?: {
      fullname?: string;
    };
    metadata?: Array<{ jaql?: unknown }>;
    count?: number;
  };
  metadata?: {
    panels?: WidgetPanel[];
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

interface WidgetFetchRequest {
  url?: string;
  token?: string;
  username?: string;
  password?: string;
  dashboardId?: string;
  widgetId?: string;
  environment?: string;
}

function extractComparableWidget(widget: SisenseWidget) {
  const query = widget.query ?? {};
  const metadata = widget.metadata ?? {};
  const panels = metadata.panels ?? [];

  return {
    widgetType: widget.type ?? null,
    widgetSubType: widget.subtype ?? null,
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
}

export async function POST(req: Request) {
  try {
    const { url, dashboardId, widgetId, environment, ...auth } =
      (await req.json()) as WidgetFetchRequest;

    if (!url || !dashboardId || !widgetId || !hasSisenseAuth(auth)) {
      return NextResponse.json(
        { error: 'url, credentials, dashboardId, and widgetId are required' },
        { status: 400 }
      );
    }

    const baseUrl = normalizeBaseUrl(url);
    const token = await resolveSisenseBearer(baseUrl, auth);
    const widgetUrl = `${baseUrl}/api/v1/dashboards/${encodeURIComponent(
      dashboardId
    )}/widgets/${encodeURIComponent(widgetId)}`;

    const response = await fetch(widgetUrl, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Sisense Error: ${errText}` },
        { status: response.status }
      );
    }

    const widget = (await response.json()) as SisenseWidget;
    const comparableWidget = extractComparableWidget(widget);

    return NextResponse.json({
      environment,
      widgetId,
      data: comparableWidget,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
