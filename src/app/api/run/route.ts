import { NextResponse } from 'next/server';
import { normalizeBaseUrl, sanitizeBearerToken } from '@/lib/network';

interface RunRequestBody {
  url?: string;
  token?: string;
}

export async function POST(req: Request) {
  try {
    const { url, token } = (await req.json()) as RunRequestBody;

    if (!url || !token) {
      return NextResponse.json({ error: 'URL and Token are required' }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(url);

    const response = await fetch(`${baseUrl}/api/v1/dashboards`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sanitizeBearerToken(token)}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Sisense responded with ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
