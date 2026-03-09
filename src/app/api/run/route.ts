import { NextResponse } from 'next/server';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer } from '@/lib/sisenseAuth';

interface RunRequestBody {
  url?: string;
  token?: string;
  username?: string;
  password?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RunRequestBody;
    const { url } = body;

    if (!url || !hasSisenseAuth(body)) {
      return NextResponse.json({ error: 'URL and credentials are required' }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(url);
    const token = await resolveSisenseBearer(baseUrl, body);

    const response = await fetch(`${baseUrl}/api/v1/dashboards`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
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
