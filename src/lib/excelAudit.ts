import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ColumnMapping {
  left: string;
  right: string;
}

export interface CompareOptions {
  trimWhitespace: boolean;
  ignoreCase: boolean;
  ignoreEmptyRows: boolean;
}

export interface InspectSheetSummary {
  name: string;
  inferredHeaderRow: number;
  headers: string[];
  rowCount: number;
  columnCount: number;
  sampleRows: string[][];
  previewRows: string[][];
}

export interface WorkbookSummary {
  sheets: InspectSheetSummary[];
}

export type WorkbookData = Record<string, string[][]>;

export interface CompareResult {
  left: {
    sheet: string;
    headerRow: number;
    headers: string[];
    rowCount: number;
    sampleRows: string[][];
  };
  right: {
    sheet: string;
    headerRow: number;
    headers: string[];
    rowCount: number;
    sampleRows: string[][];
  };
  mappings: {
    keys: ColumnMapping[];
    compare: ColumnMapping[];
  };
  summary: {
    matchedRows: number;
    mismatchedRows: number;
    leftOnlyRows: number;
    rightOnlyRows: number;
    mismatchCount: number;
    isMatch: boolean;
  };
  matchedHeaders: ColumnMapping[];
  comparisonRows: Array<{
    status: 'MATCH' | 'MISMATCH' | 'ONLY_IN_LEFT' | 'ONLY_IN_RIGHT';
    groupKey: string[];
    leftRowNumber: number | null;
    rightRowNumber: number | null;
    leftValues: Record<string, string>;
    rightValues: Record<string, string>;
  }>;
  mismatches: Array<{
    status: 'ONLY_IN_LEFT' | 'ONLY_IN_RIGHT';
    groupKey: string[];
    leftRowNumber: number | null;
    rightRowNumber: number | null;
    leftValues: Record<string, string>;
    rightValues: Record<string, string>;
  }>;
}

interface RunSuccess<T> {
  ok: true;
  data: T;
}

interface RunFailure {
  ok: false;
  error: string;
  rawOutput: string;
}

type RunResult<T> = RunSuccess<T> | RunFailure;

export async function writeUploadedFileToTemp(file: File, prefix: string): Promise<string> {
  const extension = path.extname(file.name) || '.tmp';
  const tempPath = path.join(os.tmpdir(), `${prefix}-${randomUUID()}${extension}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(tempPath, buffer);
  return tempPath;
}

export async function cleanupTempFiles(paths: Array<string | undefined | null>): Promise<void> {
  await Promise.all(
    paths.filter(Boolean).map(async (filePath) => {
      try {
        await fs.unlink(filePath as string);
      } catch {
        // Ignore cleanup failures for temp files.
      }
    })
  );
}

export async function runExcelAudit<T>(payload: object): Promise<RunResult<T>> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'excel_audit.py');

  return new Promise<RunResult<T>>((resolve) => {
    const child = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        ok: false,
        error: error.message,
        rawOutput: stderr || stdout,
      });
    });

    child.on('close', (code) => {
      let parsed: { error?: string } & T;

      try {
        parsed = JSON.parse(stdout || '{}') as { error?: string } & T;
      } catch {
        resolve({
          ok: false,
          error: stderr || 'Failed to parse spreadsheet analysis output.',
          rawOutput: stdout,
        });
        return;
      }

      if (code !== 0 || parsed.error) {
        resolve({
          ok: false,
          error: parsed.error || stderr || 'Spreadsheet analysis failed.',
          rawOutput: stdout,
        });
        return;
      }

      resolve({
        ok: true,
        data: parsed,
      });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
