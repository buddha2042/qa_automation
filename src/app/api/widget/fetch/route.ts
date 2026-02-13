import { NextResponse } from 'next/server';

function extractComparableWidget(widget: any) {
  const query = widget.query || {};
  const metadata = widget.metadata || {};
  const panels = metadata.panels || [];

  return {
    /* ===============================
       CORE IDENTIFIERS
    =============================== */
    widgetType: widget.type || null,
    widgetSubType: widget.subtype || null,

    /* ===============================
       DATASOURCE
    =============================== */
    datasource: {
      fullname:
        query.datasource?.fullname ||
        widget.datasource?.fullname ||
        null
    },


    /* ===============================
       PANEL STRUCTURE (ROWS / COLS / VALUES)
    =============================== */
    panels: panels.map((p: any) => ({
      name: p.name,
      items: (p.items || []).map((i: any) => ({
        jaql: i.jaql,
        disabled: i.disabled ?? false
      }))
    })),

    /* ===============================
       SORTING / TOP N
    =============================== */
    sort: widget.sort || null,
    top: widget.top || null,

    /* ===============================
       DRILLDOWN
    =============================== */
    drilldown: widget.drilldown || null,

    /* ===============================
       CHART CONFIGURATION
    =============================== */
    series: widget.series || null,
    xAxis: widget.xAxis || null,
    yAxis: widget.yAxis || null,
    breakBy: widget.breakBy || null,

    /* ===============================
       STYLE & FORMATTING
    =============================== */
    style: widget.style || null,
    color: widget.color || null,
    conditionalFormatting: widget.conditionalFormatting || null,

    /* ===============================
       MISC IMPORTANT FLAGS
    =============================== */
    enabled: widget.enabled ?? true,
    visible: widget.visible ?? true
  };
}


export async function POST(req: Request) {
  try {
    const { url, token, dashboardId, widgetId, environment } = await req.json();

    const baseUrl = url.replace(/\/$/, '');
    const cleanToken = token.replace('Bearer ', '');
    const widgetUrl = `${baseUrl}/api/v1/dashboards/${dashboardId}/widgets/${widgetId}`;

    const response = await fetch(widgetUrl, {
      method: 'GET',
      headers: {
        'authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `Sisense Error: ${errText}` }, { status: response.status });
    }

    const widget = await response.json();
    const comparableWidget = extractComparableWidget(widget);

    return NextResponse.json({
      environment,
      widgetId,
      data: comparableWidget // This is the "Logic DNA"
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}