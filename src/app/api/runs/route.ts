import { NextResponse } from 'next/server';
import { normalizeBaseUrl, sanitizeBearerToken } from '@/lib/network';

interface InventoryRequestBody {
  baseUrl?: string;
  token?: string;
}

const fetchDashboards = async (baseUrl: string, token: string) => {
  const sisenseRes = await fetch(`${baseUrl}/api/v1/dashboards`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${sanitizeBearerToken(token)}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!sisenseRes.ok) {
    const errorText = await sisenseRes.text();
    throw new Error(`Sisense Error: ${sisenseRes.status} - ${errorText}`);
  }

  return sisenseRes.json();
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InventoryRequestBody;
    const baseUrlInput = body.baseUrl;
    const tokenInput = body.token;

    if (!baseUrlInput || !tokenInput) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(baseUrlInput);
    const data = await fetchDashboards(baseUrl, tokenInput);

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
