import { NextResponse } from 'next/server';
import { applySupplementalFields, type SupplementalPreviewField } from '@/lib/supplemental';

export const runtime = 'nodejs';

interface ApplyRequestBody {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  datamodelId?: string;
  datamodelTitle?: string;
  cubeTableName?: string;
  fields?: SupplementalPreviewField[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ApplyRequestBody;
    if (!body.baseUrl || !body.datamodelId || !body.cubeTableName || !Array.isArray(body.fields)) {
      return NextResponse.json(
        { error: 'Sisense URL, datamodel ID, cube table name, and selected fields are required.' },
        { status: 400 }
      );
    }

    const selectedFields = body.fields.filter(
      (field) => field && field.baseColumn && field.cubeColumn && field.fieldType && !field.existsInCube
    );

    if (selectedFields.length === 0) {
      return NextResponse.json({ error: 'Select at least one new supplemental field to apply.' }, { status: 400 });
    }

    const result = await applySupplementalFields(
      body.baseUrl,
      body,
      body.datamodelId,
      body.datamodelTitle ?? '',
      body.cubeTableName,
      selectedFields
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply supplemental fields.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
