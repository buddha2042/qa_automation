import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer } from '@/lib/sisenseAuth';

interface JaqlMetadataItem {
  panel?: string;
  disabled?: boolean;
  instanceid?: string;
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
  count?: number;
  metadata?: JaqlMetadataItem[];
}

interface JaqlRequestBody {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  datasource?: string;
  jaql?: JaqlPayload;
}

function readDatasourceFromMetadata(metadata: JaqlMetadataItem[] | undefined): string | null {
  if (!Array.isArray(metadata)) return null;

  for (const item of metadata) {
    const ds = item.jaql?.datasource;
    if (ds && typeof ds === 'object' && 'fullname' in ds) {
      const fullname = (ds as { fullname?: unknown }).fullname;
      if (typeof fullname === 'string' && fullname.trim()) {
        return fullname.trim();
      }
    }
  }

  return null;
}

export async function POST(req: Request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const body = (await req.json()) as JaqlRequestBody;
    const { baseUrl, datasource, jaql, ...auth } = body;

    if (!baseUrl || !jaql || !hasSisenseAuth(auth)) {
      return NextResponse.json(
        { error: 'baseUrl, credentials, and jaql are required' },
        { status: 400 }
      );
    }

    const safeBaseUrl = normalizeBaseUrl(baseUrl);
    const token = await resolveSisenseBearer(safeBaseUrl, auth);
    const metadataDatasource = readDatasourceFromMetadata(jaql.metadata);
    const datasourceFullname =
      datasource?.trim() || jaql.datasource?.fullname?.trim() || metadataDatasource || '';

    if (!datasourceFullname) {
      return NextResponse.json(
        { error: 'Datasource fullname is missing (body.datasource or jaql.datasource.fullname).' },
        { status: 400 }
      );
    }

    const urlSegment = datasourceFullname.includes('/')
      ? datasourceFullname.split('/').pop() ?? datasourceFullname
      : datasourceFullname;
    const encodedDs = encodeURIComponent(urlSegment);
    const url = `${safeBaseUrl}/api/datasources/${encodedDs}/jaql`;

    const jaqlPayload: JaqlPayload = {
      datasource: jaql.datasource ? { ...jaql.datasource } : undefined,
      count: typeof jaql.count === 'number' ? jaql.count : 1000,
      metadata: Array.isArray(jaql.metadata) ? [...jaql.metadata] : [],
    };

    if (!jaqlPayload.datasource?.fullname) {
      jaqlPayload.datasource = { fullname: datasourceFullname };
    }

    if (
      jaqlPayload.datasource?.fullname &&
      !jaqlPayload.datasource.fullname.startsWith('localhost/')
    ) {
      jaqlPayload.datasource.fullname = `localhost/${jaqlPayload.datasource.fullname}`;
    }

    if (jaqlPayload.metadata) {
      jaqlPayload.metadata = jaqlPayload.metadata.map((item, index) => {
        const mapped: JaqlMetadataItem = { ...item };

        if (mapped.disabled) return mapped;

        if (mapped.panel === 'categories') mapped.panel = 'rows';

        if (mapped.panel !== 'scope') {
          const existingField = mapped.field ?? {};
          mapped.field = {
            ...existingField,
            index,
            id: mapped.jaql?.dim ?? existingField.id,
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
            datasource: jaqlPayload.datasource,
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
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(jaqlPayload),
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
