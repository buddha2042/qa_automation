import { NextResponse } from 'next/server';
import {
  cleanupTempFiles,
  runExcelAudit,
  type ColumnMapping,
  type CompareOptions,
  type CompareResult,
  type WorkbookData,
  writeUploadedFileToTemp,
} from '@/lib/excelAudit';
import { isUploadedFile } from '@/lib/uploadedFile';

export const runtime = 'nodejs';

interface CompareRequestBody {
  leftSheet?: string;
  rightSheet?: string;
  leftHeaderRow?: number;
  rightHeaderRow?: number;
  keyMappings?: ColumnMapping[];
  compareMappings?: ColumnMapping[];
  options?: Partial<CompareOptions>;
}

interface InlineWorkbookPayload {
  workbookData?: WorkbookData;
}

const DEFAULT_OPTIONS: CompareOptions = {
  trimWhitespace: true,
  ignoreCase: true,
  ignoreEmptyRows: true,
};

export async function POST(request: Request) {
  let leftPath: string | undefined;
  let rightPath: string | undefined;

  try {
    const formData = await request.formData();
    const leftFile = formData.get('left');
    const rightFile = formData.get('right');
    const configRaw = formData.get('config');
    const rightWorkbookRaw = formData.get('rightWorkbook');

    if (!isUploadedFile(leftFile)) {
      return NextResponse.json({ error: 'Upload the SAP BI file.' }, { status: 400 });
    }

    const config =
      typeof configRaw === 'string' && configRaw.trim().length > 0
        ? (JSON.parse(configRaw) as CompareRequestBody)
        : {};

    leftPath = await writeUploadedFileToTemp(leftFile, 'excel-left');
    if (isUploadedFile(rightFile)) {
      rightPath = await writeUploadedFileToTemp(rightFile, 'excel-right');
    }

    const rightWorkbookPayload =
      typeof rightWorkbookRaw === 'string' && rightWorkbookRaw.trim()
        ? (JSON.parse(rightWorkbookRaw) as InlineWorkbookPayload)
        : null;

    if (!rightPath && !rightWorkbookPayload?.workbookData) {
      return NextResponse.json({ error: 'Provide either a Sisense file or a Sisense widget source.' }, { status: 400 });
    }

    const result = await runExcelAudit<CompareResult>({
      action: 'compare',
      leftPath,
      rightPath,
      rightWorkbook: rightWorkbookPayload?.workbookData,
      leftSheet: config.leftSheet,
      rightSheet: config.rightSheet,
      leftHeaderRow: config.leftHeaderRow,
      rightHeaderRow: config.rightHeaderRow,
      keyMappings: config.keyMappings ?? [],
      compareMappings: config.compareMappings ?? [],
      options: {
        ...DEFAULT_OPTIONS,
        ...(config.options ?? {}),
      },
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compare spreadsheet files.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await cleanupTempFiles([leftPath, rightPath]);
  }
}
