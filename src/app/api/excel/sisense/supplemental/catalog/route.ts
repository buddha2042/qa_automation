import { NextResponse } from 'next/server';
import { fetchSupplementalCatalog } from '@/lib/supplemental';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const catalog = await fetchSupplementalCatalog();
    return NextResponse.json({ catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load supplemental catalog.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
