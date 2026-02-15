import { NextResponse } from 'next/server';
import { getRunsByRunId } from '@/lib/store';

type DiffItem = {
  path: string;
  regular: unknown;
  refactor: unknown;
  type: 'MISSING_IN_REGULAR' | 'MISSING_IN_REFACTOR' | 'VALUE_MISMATCH';
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function diffObjects(a: unknown, b: unknown, path = ''): DiffItem[] {
  const left = isObject(a) ? a : {};
  const right = isObject(b) ? b : {};
  const diffs: DiffItem[] = [];

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const key of keys) {
    const newPath = path ? `${path}.${key}` : key;
    const valA = left[key];
    const valB = right[key];

    if (valA === undefined) {
      diffs.push({ path: newPath, regular: null, refactor: valB, type: 'MISSING_IN_REGULAR' });
      continue;
    }

    if (valB === undefined) {
      diffs.push({ path: newPath, regular: valA, refactor: null, type: 'MISSING_IN_REFACTOR' });
      continue;
    }

    if (isObject(valA) && isObject(valB)) {
      diffs.push(...diffObjects(valA, valB, newPath));
    } else if (JSON.stringify(valA) !== JSON.stringify(valB)) {
      diffs.push({ path: newPath, regular: valA, refactor: valB, type: 'VALUE_MISMATCH' });
    }
  }

  return diffs;
}

export async function POST(req: Request) {
  const { runId } = (await req.json()) as { runId?: string };

  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  }

  const runs = getRunsByRunId(runId);
  const regular = runs.find((r) => r.environment === 'regular');
  const refactor = runs.find((r) => r.environment === 'refactor');

  if (!regular || !refactor) {
    return NextResponse.json({ error: 'Both runs required' }, { status: 400 });
  }

  const diffs = diffObjects(regular.payload, refactor.payload);

  return NextResponse.json({
    summary: {
      totalDifferences: diffs.length,
    },
    differences: diffs,
  });
}
