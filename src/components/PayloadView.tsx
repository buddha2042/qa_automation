'use client';

import { useMemo, useState } from 'react';

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

interface PayloadViewProps {
  data: unknown;
  emptyText?: string;
  title?: string;
}

const toDisplay = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const getFormatLabel = (value: unknown): string => {
  if (Array.isArray(value)) return 'Array';
  if (value && typeof value === 'object') return 'Object';
  if (value === null) return 'Null';
  return 'Primitive';
};

function isArrayOfObjects(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === 'object' && !Array.isArray(item))
  );
}

export default function PayloadView({ data, emptyText = 'No payload available', title }: PayloadViewProps) {
  const [mode, setMode] = useState<'table' | 'json'>('table');

  const format = useMemo(() => getFormatLabel(data), [data]);

  if (data === null || data === undefined) {
    return <div className="text-slate-400 italic text-sm">{emptyText}</div>;
  }

  const renderTable = () => {
    if (isArrayOfObjects(data)) {
      const allColumns = Array.from(
        new Set(data.flatMap((row) => Object.keys(row)))
      );

      return (
        <div className="overflow-auto max-h-[320px] rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b">
              <tr>
                {allColumns.map((col) => (
                  <th key={col} className="text-left p-3 font-bold text-slate-500">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} className="border-b last:border-b-0">
                  {allColumns.map((col) => (
                    <td key={col} className="p-3 align-top text-slate-700 font-mono">
                      {toDisplay(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return (
        <div className="overflow-auto max-h-[320px] rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-bold text-slate-500 w-1/3">Field</th>
                <th className="text-left p-3 font-bold text-slate-500">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data as Record<string, unknown>).map(([key, value]) => (
                <tr key={key} className="border-b last:border-b-0">
                  <td className="p-3 align-top text-slate-600 font-bold">{key}</td>
                  <td className="p-3 align-top text-slate-700 font-mono">{toDisplay(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return <div className="text-sm text-slate-700 font-mono">{toDisplay(data)}</div>;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-slate-500 font-bold">
          {title ? `${title} • ` : ''}Format: {format}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('table')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${
              mode === 'table' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            Table
          </button>
          <button
            onClick={() => setMode('json')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${
              mode === 'json' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            JSON
          </button>
        </div>
      </div>

      {mode === 'table' ? (
        renderTable()
      ) : (
        <pre className="p-4 text-[12px] rounded-xl bg-slate-900 text-emerald-400 overflow-auto max-h-[320px] border border-slate-800">
          {JSON.stringify(data as JsonLike, null, 2)}
        </pre>
      )}
    </div>
  );
}
