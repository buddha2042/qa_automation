import { NextResponse } from 'next/server';
import { buildSupplementalPreview, fetchSupplementalCatalog } from '@/lib/supplemental';

export const runtime = 'nodejs';

interface PreviewRequestBody {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  datamodelId?: string;
  baseSupplemental?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewRequestBody;
    if (!body.baseUrl || !body.datamodelId || !body.baseSupplemental) {
      return NextResponse.json(
        { error: 'Sisense URL, datamodel ID, and supplemental table are required.' },
        { status: 400 }
      );
    }

    const catalog = await fetchSupplementalCatalog();
    const catalogItem = catalog.find((item) => item.BASE_SUPPEMENTAL === body.baseSupplemental);
    if (!catalogItem) {
      return NextResponse.json({ error: 'Selected supplemental table was not found.' }, { status: 404 });
    }

    const preview = await buildSupplementalPreview(body.baseUrl, body, body.datamodelId, catalogItem);
    return NextResponse.json({ preview, catalogItem });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build supplemental preview.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
