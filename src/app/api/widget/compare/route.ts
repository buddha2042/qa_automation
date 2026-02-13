import { NextResponse } from 'next/server';

/**
 * Deeply compares two objects and returns a list of differences
 */
function getDeepDiff(obj1: any, obj2: any, path = ''): any[] {
  const diffs: any[] = [];

  // Get all unique keys from both objects
  const allKeys = Array.from(new Set([
    ...Object.keys(obj1 || {}), 
    ...Object.keys(obj2 || {})
  ]));

  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const val1 = obj1?.[key];
    const val2 = obj2?.[key];

    // 1. If both are objects (and not null), recurse
    if (
      typeof val1 === 'object' && val1 !== null &&
      typeof val2 === 'object' && val2 !== null &&
      !Array.isArray(val1)
    ) {
      diffs.push(...getDeepDiff(val1, val2, currentPath));
    } 
    // 2. Special handling for Arrays
    else if (Array.isArray(val1) || Array.isArray(val2)) {
      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        diffs.push({
          path: currentPath,
          regularValue: val1,
          refactorValue: val2,
          message: 'Array mismatch'
        });
      }
    }
    // 3. Primitive values (strings, numbers, booleans)
    else if (val1 !== val2) {
      diffs.push({
        path: currentPath,
        regularValue: val1,
        refactorValue: val2,
        message: 'Value mismatch'
      });
    }
  }

  return diffs;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { regular, refactor } = body;

    if (!regular || !refactor) {
      return NextResponse.json(
        { error: 'Both regular and refactor payloads are required' }, 
        { status: 400 }
      );
    }

    // Run the comparison logic
    const differences = getDeepDiff(regular, refactor);

    return NextResponse.json({ 
      data: differences,
      match: differences.length === 0 
    });
  } catch (error: any) {
    console.error("Compare Error:", error);
    return NextResponse.json(
      { error: 'Failed to process comparison: ' + error.message }, 
      { status: 500 }
    );
  }
}