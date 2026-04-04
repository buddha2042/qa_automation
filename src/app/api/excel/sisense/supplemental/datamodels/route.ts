import { NextResponse } from 'next/server';
import { fetchSisenseDatamodels } from '@/lib/supplemental';

export const runtime = 'nodejs';

interface DatamodelRequestBody {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DatamodelRequestBody;
    if (!body.baseUrl) {
      return NextResponse.json({ error: 'Sisense URL is required.' }, { status: 400 });
    }

    const result = await fetchSisenseDatamodels(body.baseUrl, body);
    return NextResponse.json({ datamodels: result.datamodels });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load datamodels.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
