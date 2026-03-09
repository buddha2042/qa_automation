import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import {
  cleanupTempFiles,
  runSmodelCompare,
  writeUploadedSmodelToTemp,
} from '@/lib/smodelCompare';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let leftPath: string | undefined;
  let rightPath: string | undefined;
  let outputPath: string | undefined;

  try {
    const formData = await request.formData();
    const leftFile = formData.get('left');
    const rightFile = formData.get('right');

    if (!(leftFile instanceof File) || !(rightFile instanceof File)) {
      return NextResponse.json(
        { error: 'Upload both .smodel files using fields left and right.' },
        { status: 400 }
      );
    }

    leftPath = await writeUploadedSmodelToTemp(leftFile, 'smodel-left');
    rightPath = await writeUploadedSmodelToTemp(rightFile, 'smodel-right');

    const result = await runSmodelCompare(leftPath, rightPath);
    outputPath = result.outputPath;

    const outputBytes = await fs.readFile(outputPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `smodel_comparison_${timestamp}.xlsx`;

    return new NextResponse(outputBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compare .smodel files.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await cleanupTempFiles([leftPath, rightPath, outputPath]);
  }
}
