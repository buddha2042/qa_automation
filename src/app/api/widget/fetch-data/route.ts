import { NextResponse } from 'next/server';
import { normalizeBaseUrl, sanitizeBearerToken } from '@/lib/network';

interface WidgetPayload {
  datasource?: { fullname?: string };
  query?: {
    datasource?: { fullname?: string };
    metadata?: Array<Record<string, unknown>>;
    count?: number;
  };
}

interface FetchDataRequest {
  url?: string;
  token?: string;
  widgetPayload?: WidgetPayload;
}

type JaqlApiResponse = {
  values?: unknown[];
  data?: {
    values?: unknown[];
  };
  error?: {
    message?: string;
  };
  message?: string;
};

const readDatasourceFullname = (payload: WidgetPayload): string =>
  payload.query?.datasource?.fullname?.trim() ||
  payload.datasource?.fullname?.trim() ||
  '';

const normalizeDatasourceForBody = (fullname: string): { fullname: string } => ({
  fullname: fullname.startsWith('localhost/') ? fullname : `localhost/${fullname}`,
});

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
    const datasourceFullname = readDatasourceFullname(widgetPayload);
    const metadata = widgetPayload.query?.metadata ?? [];

    if (!datasourceFullname || metadata.length === 0) {
      return NextResponse.json(
        { error: 'Widget query datasource/metadata are missing for preview.' },
        { status: 400 }
      );
    }

    const datasourceId = datasourceFullname.includes('/')
      ? datasourceFullname.split('/').pop() ?? datasourceFullname
      : datasourceFullname;

    const jaqlBody = {
      datasource: normalizeDatasourceForBody(datasourceFullname),
      metadata,
      count: widgetPayload.query?.count ?? 1000,
    };

    const response = await fetch(
      `${cleanBaseUrl}/api/datasources/${encodeURIComponent(datasourceId)}/jaql`,
      {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sanitizeBearerToken(token)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(jaqlBody),
      cache: 'no-store',
      }
    );

    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const payload = isJson
      ? ((await response.json()) as JaqlApiResponse)
      : ({ message: await response.text() } as JaqlApiResponse);

    if (!response.ok) {
      const message =
        payload.error?.message ?? payload.message ?? `Sisense JAQL Error ${response.status}`;
      return NextResponse.json({ error: message, details: payload }, { status: response.status });
    }

    const values = Array.isArray(payload.values)
      ? payload.values
      : Array.isArray(payload.data?.values)
        ? payload.data.values
        : [];

    return NextResponse.json({
      rowCount: values.length,
      data: values,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
