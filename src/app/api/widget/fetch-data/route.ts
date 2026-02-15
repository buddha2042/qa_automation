import { NextResponse } from 'next/server';
import { normalizeBaseUrl, sanitizeBearerToken } from '@/lib/network';

interface WidgetPayload {
  datasource?: { fullname?: string };
  query?: {
    metadata?: Array<{ jaql?: unknown }>;
    count?: number;
  };
}

interface FetchDataRequest {
  url?: string;
  token?: string;
  widgetPayload?: WidgetPayload;
}

export async function POST(req: Request) {
  try {
    const { url, token, widgetPayload } = (await req.json()) as FetchDataRequest;

    if (!url || !token || !widgetPayload) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const cleanBaseUrl = normalizeBaseUrl(url);

    const jaqlBody = {
      datasource: widgetPayload.datasource?.fullname,
      metadata: (widgetPayload.query?.metadata ?? []).map((m) => ({
        jaql: m.jaql,
      })),
      count: widgetPayload.query?.count ?? 1000,
    };

    const response = await fetch(`${cleanBaseUrl}/api/v1/jaql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sanitizeBearerToken(token)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jaqlBody),
      cache: 'no-store',
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: `Sisense JAQL Error ${response.status}: ${err}` },
        { status: response.status }
      );
    }

    const result = (await response.json()) as { values?: unknown[] };

    return NextResponse.json({
      rowCount: result.values?.length ?? 0,
      data: result.values ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
