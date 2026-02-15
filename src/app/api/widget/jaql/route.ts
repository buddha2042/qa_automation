import { NextResponse } from 'next/server';
import { normalizeBaseUrl, sanitizeBearerToken } from '@/lib/network';

interface JaqlMetadataItem {
  panel?: string;
  jaql?: {
    dim?: string;
    datasource?: unknown;
    pv?: Record<string, number>;
  };
  field?: {
    index?: number;
    id?: string;
  };
}

interface JaqlPayload {
  datasource?: {
    fullname?: string;
  };
  metadata?: JaqlMetadataItem[];
}

interface JaqlRequestBody {
  baseUrl?: string;
  token?: string;
  datasource?: string;
  jaql?: JaqlPayload;
}

export async function POST(req: Request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const body = (await req.json()) as JaqlRequestBody;
    const { baseUrl, token, datasource, jaql } = body;

    if (!baseUrl || !token || !datasource || !jaql) {
      return NextResponse.json(
        { error: 'baseUrl, token, datasource, and jaql are required' },
        { status: 400 }
      );
    }

    const safeBaseUrl = normalizeBaseUrl(baseUrl);
    const urlSegment = datasource.includes('/')
      ? datasource.split('/').pop() ?? datasource
      : datasource;
    const encodedDs = encodeURIComponent(urlSegment);
    const url = `${safeBaseUrl}/api/datasources/${encodedDs}/jaql`;

    if (jaql.metadata) {
      if (jaql.datasource?.fullname && !jaql.datasource.fullname.startsWith('localhost/')) {
        jaql.datasource.fullname = `localhost/${jaql.datasource.fullname}`;
      }

      jaql.metadata = jaql.metadata.map((item, index) => {
        const mapped: JaqlMetadataItem = { ...item };

        if (mapped.panel === 'categories') mapped.panel = 'rows';

        if (mapped.panel !== 'scope' && mapped.field) {
          mapped.field = {
            ...mapped.field,
            index,
            id: mapped.jaql?.dim ?? mapped.field.id,
          };
        }

        if (mapped.panel === 'rows' && mapped.jaql) {
          mapped.jaql = {
            ...mapped.jaql,
            pv: {
              'Visible in View>Yes': 2,
              'Aggregation>Count': 2,
            },
          };
        }

        if (mapped.panel === 'scope' && mapped.jaql && !mapped.jaql.datasource) {
          mapped.jaql = {
            ...mapped.jaql,
            datasource: jaql.datasource,
          };
        }

        return mapped;
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${sanitizeBearerToken(token)}`,
      },
      body: JSON.stringify(jaql),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type');

    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Sisense returned an invalid format (non-JSON response).' },
        { status: response.status }
      );
    }

    const data = (await response.json()) as {
      values?: unknown[];
      error?: { message?: string };
      message?: string;
    };

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data.error?.message ?? data.message ?? 'Sisense execution error',
          details: data,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Sisense query timed out (request took too long).' },
        { status: 504 }
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
