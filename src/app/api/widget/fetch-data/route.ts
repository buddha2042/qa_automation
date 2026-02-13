import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { url, token, widgetPayload } = await req.json();

    if (!url || !token || !widgetPayload) {
      throw new Error('Missing required parameters');
    }

    const cleanBaseUrl = url.replace(/\/$/, '');

    /* ===============================
       BUILD PERFECT JAQL PAYLOAD
    =============================== */
    const jaqlBody = {
      datasource: widgetPayload.datasource.fullname,
      metadata: widgetPayload.query.metadata.map((m: any) => ({
        jaql: m.jaql
      })),
      count: widgetPayload.query.count ?? 1000
    };

    const response = await fetch(`${cleanBaseUrl}/api/v1/jaql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.replace('Bearer ', '')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(jaqlBody),
      cache: 'no-store'
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: `Sisense JAQL Error ${response.status}: ${err}` },
        { status: response.status }
      );
    }

    const result = await response.json();

    return NextResponse.json({
      rowCount: result.values?.length ?? 0,
      data: result.values
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: e.message },
      { status: 500 }
    );
  }
}
