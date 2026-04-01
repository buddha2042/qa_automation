import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface PythonCandidate {
  command: string;
  prefixArgs: string[];
}

export interface PythonRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
}

function addCandidate(
  candidates: PythonCandidate[],
  seen: Set<string>,
  command: string | undefined,
  prefixArgs: string[] = []
) {
  if (!command) return;
  const key = `${command}\u0000${prefixArgs.join('\u0000')}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ command, prefixArgs });
}

export async function getPythonCandidates(): Promise<PythonCandidate[]> {
  const candidates: PythonCandidate[] = [];
  const seen = new Set<string>();
  const cwd = process.cwd();

  addCandidate(candidates, seen, process.env.PYTHON_BIN);

  const venvCandidates = process.platform === 'win32'
    ? [path.join(cwd, '.venv', 'Scripts', 'python.exe')]
    : [path.join(cwd, '.venv', 'bin', 'python3'), path.join(cwd, '.venv', 'bin', 'python')];

  for (const candidate of venvCandidates) {
    try {
      await fs.access(candidate);
      addCandidate(candidates, seen, candidate);
    } catch {
      // Ignore missing venv interpreters.
    }
  }

  if (process.platform === 'win32') {
    addCandidate(candidates, seen, 'py', ['-3']);
    addCandidate(candidates, seen, 'python3');
    addCandidate(candidates, seen, 'python');
  } else {
    addCandidate(candidates, seen, 'python3');
    addCandidate(candidates, seen, 'python');
  }

  return candidates;
}

function shouldTryNextCandidate(result: PythonRunResult): boolean {
  if (result.code === null) return true;
  const combinedOutput = `${result.stderr}\n${result.stdout}`;

  return /python was not found|no python at|app execution aliases|not recognized as an internal or external command/i.test(
    combinedOutput
  );
}

function runCandidate(
  candidate: PythonCandidate,
  scriptPath: string,
  scriptArgs: string[],
  stdinText?: string
): Promise<PythonRunResult | null> {
  const args = [...candidate.prefixArgs, scriptPath, ...scriptArgs];

  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, args, {
      stdio: stdinText === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve(null);
        return;
      }

      reject(error);
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        command: candidate.command,
        args,
      });
    });

    if (stdinText !== undefined) {
      child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}

export async function runPythonScript(
  scriptPath: string,
  scriptArgs: string[] = [],
  stdinText?: string
): Promise<PythonRunResult> {
  const candidates = await getPythonCandidates();
  let lastFailure: PythonRunResult | null = null;

  for (const candidate of candidates) {
    const result = await runCandidate(candidate, scriptPath, scriptArgs, stdinText);

    if (!result) {
      continue;
    }

    if (result.code === 0) {
      return result;
    }

    lastFailure = result;
    if (!shouldTryNextCandidate(result)) {
      return result;
    }
  }

  if (lastFailure) {
    return lastFailure;
  }

  return {
    code: null,
    stdout: '',
    stderr:
      'Python 3 runtime not found. Install Python 3.10+ or create a local .venv before running spreadsheet comparison.',
    command: '',
    args: [],
  };
}
