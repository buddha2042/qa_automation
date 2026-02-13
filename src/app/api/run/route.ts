import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { url, token } = await req.json();

    if (!url || !token) {
      return NextResponse.json({ error: 'URL and Token are required' }, { status: 400 });
    }

    const baseUrl = url.replace(/\/$/, "");

    const response = await fetch(`${baseUrl}/api/v1/dashboards`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token.replace('Bearer ', '')}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Sisense responded with ${response.status}: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json({ data });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}