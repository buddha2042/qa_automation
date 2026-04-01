import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPythonScript } from '@/lib/pythonRuntime';

export interface SmodelCompareRunResult {
  outputPath: string;
  jsonOutputPath?: string;
  stdout: string;
  stderr: string;
}

export async function writeUploadedSmodelToTemp(file: File, prefix: string): Promise<string> {
  const extension = path.extname(file.name) || '.smodel';
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

export async function runSmodelCompare(
  modelAPath: string,
  modelBPath: string,
  jsonOutputPath?: string
): Promise<SmodelCompareRunResult> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'sisense_smodel_comparison_extract.py');
  const outputPath = path.join(os.tmpdir(), `smodel-compare-${randomUUID()}.xlsx`);
  const { code, stdout, stderr } = await runPythonScript(scriptPath, [
    modelAPath,
    modelBPath,
    '--out',
    outputPath,
    ...(jsonOutputPath ? ['--json-out', jsonOutputPath] : []),
  ]);

  if (code !== 0) {
    throw new Error(
      stderr || stdout || 'Sisense smodel comparison failed. Install Python 3.10+ or run `npm run setup:python`.'
    );
  }

  try {
    await fs.access(outputPath);
  } catch {
    throw new Error('Comparison script completed but output file was not created.');
  }

  return { outputPath, jsonOutputPath, stdout, stderr };
}
