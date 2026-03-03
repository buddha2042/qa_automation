import { NextResponse } from 'next/server';
import {
  cleanupTempFiles,
  runExcelAudit,
  type WorkbookData,
  type WorkbookSummary,
  writeUploadedFileToTemp,
} from '@/lib/excelAudit';

export const runtime = 'nodejs';

interface InspectResponse {
  workbooks: {
    left?: WorkbookSummary;
    right?: WorkbookSummary;
  };
}

interface InlineWorkbookPayload {
  workbookData?: WorkbookData;
}

export async function POST(request: Request) {
  let leftPath: string | undefined;
  let rightPath: string | undefined;

  try {
    const formData = await request.formData();
    const leftFile = formData.get('left');
    const rightFile = formData.get('right');
    const rightWorkbookRaw = formData.get('rightWorkbook');

    if (!(leftFile instanceof File)) {
      return NextResponse.json({ error: 'Upload the SAP BI file.' }, { status: 400 });
    }

    leftPath = await writeUploadedFileToTemp(leftFile, 'excel-left');
    if (rightFile instanceof File) {
      rightPath = await writeUploadedFileToTemp(rightFile, 'excel-right');
    }

    const rightWorkbookPayload =
      typeof rightWorkbookRaw === 'string' && rightWorkbookRaw.trim()
        ? (JSON.parse(rightWorkbookRaw) as InlineWorkbookPayload)
        : null;

    const result = await runExcelAudit<InspectResponse>({
      action: 'inspect',
      files: [
        { id: 'left', path: leftPath },
        ...(rightPath || rightWorkbookPayload?.workbookData
          ? [
              {
                id: 'right',
                path: rightPath,
                workbook: rightWorkbookPayload?.workbookData,
              },
            ]
          : []),
      ],
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to inspect spreadsheet files.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await cleanupTempFiles([leftPath, rightPath]);
  }
}
