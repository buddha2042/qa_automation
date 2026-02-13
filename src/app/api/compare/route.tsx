import { NextResponse } from 'next/server';
import { getRunsByRunId } from '@/lib/store'; // in-memory 

function diffObjects(a: any, b: any, path = ''): any[] {
  const diffs: any[] = [];
  const keys = new Set([
    ...Object.keys(a || {}),
    ...Object.keys(b || {})
  ]);

  for (const key of keys) {
    const newPath = path ? `${path}.${key}` : key;
    const valA = a?.[key];
    const valB = b?.[key];

    if (valA === undefined) {
      diffs.push({ path: newPath, regular: null, refactor: valB, type: 'MISSING_IN_REGULAR' });
      continue;
    }

    if (valB === undefined) {
      diffs.push({ path: newPath, regular: valA, refactor: null, type: 'MISSING_IN_REFACTOR' });
      continue;
    }

    if (typeof valA === 'object' && typeof valB === 'object' && valA && valB) {
      diffs.push(...diffObjects(valA, valB, newPath));
    } else if (valA !== valB) {
      diffs.push({
        path: newPath,
        regular: valA,
        refactor: valB,
        type: 'VALUE_MISMATCH'
      });
    }
  }

  return diffs;
}

export async function POST(req: Request) {
  const { runId } = await req.json();

  const runs = getRunsByRunId(runId);
  const regular = runs.find(r => r.environment === 'regular');
  const refactor = runs.find(r => r.environment === 'refactor');

  if (!regular || !refactor) {
    return NextResponse.json(
      { error: 'Both runs required' },
      { status: 400 }
    );
  }

  const diffs = diffObjects(
    regular.payload,
    refactor.payload
  );

  return NextResponse.json({
    summary: {
      totalDifferences: diffs.length
    },
    differences: diffs
  });
}
