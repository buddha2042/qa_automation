// src/lib/store.ts

type Environment = 'regular' | 'refactor';

export interface QaRun {
  runId: string;
  environment: Environment;
  baseUrl: string;
  createdAt: string;
  payload: any;
}

/**
 * In-memory store (dev / prototype)
 * Later you can replace this with DB (Mongo, Postgres, etc.)
 */
const RUNS: QaRun[] = [];

/* ===============================
   WRITE
   =============================== */
export function saveRun(run: QaRun) {
  // Enforce ONE run per (runId + environment)
  const exists = RUNS.find(
    r => r.runId === run.runId && r.environment === run.environment
  );

  if (exists) {
    throw new Error('Run already exists for this environment');
  }

  RUNS.push(run);
}

/* ===============================
   READ
   =============================== */
export function getAllRuns(): QaRun[] {
  return [...RUNS];
}

export function getRunsByRunId(runId: string): QaRun[] {
  return RUNS.filter(r => r.runId === runId);
}
