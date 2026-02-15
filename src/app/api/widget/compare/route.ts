import { NextResponse } from 'next/server';

type Difference = {
  path: string;
  regularValue: unknown;
  refactorValue: unknown;
  message: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDeepDiff(obj1: unknown, obj2: unknown, path = ''): Difference[] {
  const diffs: Difference[] = [];
  const left = isObject(obj1) ? obj1 : {};
  const right = isObject(obj2) ? obj2 : {};

  const allKeys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)]));

  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const val1 = left[key];
    const val2 = right[key];

    if (isObject(val1) && isObject(val2)) {
      diffs.push(...getDeepDiff(val1, val2, currentPath));
    } else if (Array.isArray(val1) || Array.isArray(val2)) {
      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        diffs.push({
          path: currentPath,
          regularValue: val1,
          refactorValue: val2,
          message: 'Array mismatch',
        });
      }
    } else if (val1 !== val2) {
      diffs.push({
        path: currentPath,
        regularValue: val1,
        refactorValue: val2,
        message: 'Value mismatch',
      });
    }
  }

  return diffs;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { regular?: unknown; refactor?: unknown };
    const { regular, refactor } = body;

    if (regular === undefined || refactor === undefined) {
      return NextResponse.json(
        { error: 'Both regular and refactor payloads are required' },
        { status: 400 }
      );
    }

    const differences = getDeepDiff(regular, refactor);

    return NextResponse.json({
      data: differences,
      match: differences.length === 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to process comparison: ${message}` },
      { status: 500 }
    );
  }
}
