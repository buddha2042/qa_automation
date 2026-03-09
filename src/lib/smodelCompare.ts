import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  const venvPythonPath = path.join(process.cwd(), '.venv', 'bin', 'python3');
  const pythonCommand = await fs
    .access(venvPythonPath)
    .then(() => venvPythonPath)
    .catch(() => 'python3');
  const args = [scriptPath, modelAPath, modelBPath, '--out', outputPath];
  if (jsonOutputPath) {
    args.push('--json-out', jsonOutputPath);
  }

  return new Promise<SmodelCompareRunResult>((resolve, reject) => {
    const child = spawn(pythonCommand, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
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
      reject(new Error(error.message));
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || 'Sisense smodel comparison failed.'));
        return;
      }

      try {
        await fs.access(outputPath);
      } catch {
        reject(new Error('Comparison script completed but output file was not created.'));
        return;
      }

      resolve({ outputPath, jsonOutputPath, stdout, stderr });
    });
  });
}
