import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupTempFiles,
  runSmodelCompare,
  writeUploadedSmodelToTemp,
} from '@/lib/smodelCompare';
import { isUploadedFile } from '@/lib/uploadedFile';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let leftPath: string | undefined;
  let rightPath: string | undefined;
  let outputPath: string | undefined;
  let jsonPath: string | undefined;

  try {
    const formData = await request.formData();
    const leftFile = formData.get('left');
    const rightFile = formData.get('right');

    if (!isUploadedFile(leftFile) || !isUploadedFile(rightFile)) {
      return NextResponse.json(
        { error: 'Upload both .smodel files using fields left and right.' },
        { status: 400 }
      );
    }

    leftPath = await writeUploadedSmodelToTemp(leftFile, 'smodel-left');
    rightPath = await writeUploadedSmodelToTemp(rightFile, 'smodel-right');
    jsonPath = path.join(os.tmpdir(), `smodel-compare-${randomUUID()}.json`);

    const result = await runSmodelCompare(leftPath, rightPath, jsonPath);
    outputPath = result.outputPath;

    if (!result.jsonOutputPath) {
      throw new Error('Comparison script did not produce JSON output.');
    }

    const payloadText = await fs.readFile(result.jsonOutputPath, 'utf-8');
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compare .smodel files.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await cleanupTempFiles([leftPath, rightPath, outputPath, jsonPath]);
  }
}
