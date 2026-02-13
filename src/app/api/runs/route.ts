import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const baseUrlInput = searchParams.get('baseUrl');
    const tokenInput = searchParams.get('token');

    if (!baseUrlInput || !tokenInput) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    // Clean URL
    let finalUrl = baseUrlInput.replace(/\/$/, "");

    // If the user didn't provide the path, add it
    if (!finalUrl.includes('/api/v1/dashboards')) {
      finalUrl += '/api/v1/dashboards';
    }

    const token = tokenInput.replace('Bearer ', '');

    console.log(`Inventory Proxy: Requesting ${finalUrl}`);

    const sisenseRes = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store'
    });

    if (!sisenseRes.ok) {
      const errorText = await sisenseRes.text();
      return NextResponse.json(
        { error: `Sisense Error: ${sisenseRes.status} - ${errorText}` }, 
        { status: sisenseRes.status }
      );
    }

    const data = await sisenseRes.json();
    return NextResponse.json({ data });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}