import { NextResponse } from 'next/server';
import {
  listSmodelTransferCandidates,
  transferSmodelTable,
  type SmodelDocument,
} from '@/lib/smodelTransfer';
import { isUploadedFile } from '@/lib/uploadedFile';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const leftFile = formData.get('left');
    const rightFile = formData.get('right');
    const action = String(formData.get('action') ?? 'transfer').trim();
    const tableName = String(formData.get('tableName') ?? '').trim();

    if (!isUploadedFile(leftFile) || !isUploadedFile(rightFile)) {
      return NextResponse.json(
        { error: 'Upload both .smodel files using fields left and right.' },
        { status: 400 }
      );
    }

    if (!tableName) {
      return NextResponse.json({ error: 'Enter a table name to transfer.' }, { status: 400 });
    }

    const sourceText = Buffer.from(await leftFile.arrayBuffer()).toString('utf-8');
    const targetText = Buffer.from(await rightFile.arrayBuffer()).toString('utf-8');
    const sourceModel = JSON.parse(sourceText) as SmodelDocument;
    const targetModel = JSON.parse(targetText) as SmodelDocument;

    if (action === 'inspect') {
      return NextResponse.json(listSmodelTransferCandidates(sourceModel, targetModel, tableName));
    }

    const sourceDatasetIndex = Number(formData.get('sourceDatasetIndex'));
    const sourceTableIndex = Number(formData.get('sourceTableIndex'));
    const rawTargetDatasetIndex = formData.get('targetDatasetIndex');
    const rawTargetTableIndex = formData.get('targetTableIndex');

    const result = transferSmodelTable(sourceModel, targetModel, tableName, {
      sourceDatasetIndex: Number.isInteger(sourceDatasetIndex) ? sourceDatasetIndex : undefined,
      sourceTableIndex: Number.isInteger(sourceTableIndex) ? sourceTableIndex : undefined,
      targetDatasetIndex: rawTargetDatasetIndex === null || String(rawTargetDatasetIndex).trim() === '' ? undefined : Number(rawTargetDatasetIndex),
      targetTableIndex: rawTargetTableIndex === null || String(rawTargetTableIndex).trim() === '' ? undefined : Number(rawTargetTableIndex),
    });
    const sourceBaseName = leftFile.name.replace(/\.[^/.]+$/, '') || 'source';
    const targetBaseName = rightFile.name.replace(/\.[^/.]+$/, '') || 'target';
    const safeTableName =
      tableName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'table';

    return NextResponse.json({
      preview: result.preview,
      transformedModelText: JSON.stringify(result.transformedModel, null, 2),
      suggestedFilename: `${targetBaseName}_with_${safeTableName}_from_${sourceBaseName}.smodel`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to transfer the selected table.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
