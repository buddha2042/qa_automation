'use client';

import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQa, QaInputs } from '@/context/QaContext';
import PayloadView from '@/components/PayloadView';
import AppHeader from '@/components/AppHeader';
import {
  Search,
  CheckCircle2,
  XCircle,
  Download,
  Database,
  Zap,
  FileJson,
  Filter,
  Copy,
} from 'lucide-react';

type Environment = 'regular' | 'refactor';
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface ComparisonItem {
  path: string;
  regularValue: JsonValue | undefined;
  refactorValue: JsonValue | undefined;
  isMatch: boolean;
}

interface WidgetPayload {
  [key: string]: JsonValue;
}

interface WidgetPanelItem {
  jaql?: {
    title?: string;
    dim?: string;
    formula?: string;
    datatype?: string;
    filter?: {
      members?: string[];
    };
  };
  disabled?: boolean;
}

interface WidgetPanel {
  name?: string;
  items?: WidgetPanelItem[];
}

interface WidgetPayloadTyped extends WidgetPayload {
  widgetType?: JsonValue;
  widgetSubType?: JsonValue;
  panels?: JsonValue;
  style?: JsonValue;
  datasource?: {
    fullname?: string;
  };
}

const EMPTY_INPUTS: QaInputs = {
  regUrl: '',
  regToken: '',
  regDashId: '',
  regWidgetId: '',
  refUrl: '',
  refToken: '',
  refDashId: '',
  refWidgetId: '',
};

const csvEscape = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const isLeafValue = (val: unknown) =>
  val === null ||
  typeof val !== 'object' ||
  (Array.isArray(val) && val.length === 0) ||
  (typeof val === 'object' && val !== null && Object.keys(val).length === 0);

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

interface PreviewQueryBody {
  datasource: WidgetPayloadTyped['datasource'];
  metadata: Array<{ jaql: WidgetPanelItem['jaql']; panel: string | undefined }>;
}

const prepareJaqlBody = (widgetJson: WidgetPayloadTyped): PreviewQueryBody | null => {
  const panels = asPanels(widgetJson.panels);
  if (panels.length === 0) return null;

  const metadata = panels.flatMap((panel) =>
    (panel.items ?? []).map((item) => ({
      jaql: item.jaql,
      panel: panel.name,
    }))
  );

  return { datasource: widgetJson.datasource, metadata };
};

const normalizePreviewRows = (values: unknown, expectedColumns: number): string[][] => {
  if (!Array.isArray(values)) return [];

  return values.map((row) => {
    const arr = Array.isArray(row) ? row : [row];
    const normalized = arr.slice(0, expectedColumns).map((cell) => {
      if (cell && typeof cell === 'object') {
        const obj = cell as { text?: unknown; data?: unknown };
        if (typeof obj.text === 'string') return obj.text;
        if (obj.data !== undefined && obj.data !== null) return String(obj.data);
      }
      if (cell === null || cell === undefined) return '';
      return String(cell);
    });

    while (normalized.length < expectedColumns) normalized.push('');
    return normalized;
  });
};

const getPreviewHeadersFromPayload = (payload: WidgetPayloadTyped | null): string[] => {
  if (!payload) return [];

  const panels = asPanels(payload.panels);
  const orderedPanelNames = ['rows', 'columns', 'values', 'breakBy', 'series', 'categories'];
  const labelByPanel = new Map<string, string[]>();

  for (const panel of panels) {
    const name = panel.name ?? 'unknown';
    const labels = (panel.items ?? [])
      .filter((item) => !item.disabled)
      .map(jaqlLabel)
      .filter(Boolean);
    labelByPanel.set(name, labels);
  }

  const orderedLabels = orderedPanelNames.flatMap((name) => labelByPanel.get(name) ?? []);
  const remainingLabels = Array.from(labelByPanel.entries())
    .filter(([name]) => !orderedPanelNames.includes(name) && name !== 'filters' && name !== 'scope')
    .flatMap(([, labels]) => labels);

  return [...orderedLabels, ...remainingLabels];
};

const maxColumnCount = (rows: string[][]): number =>
  rows.reduce((max, row) => Math.max(max, row.length), 0);

const buildDynamicHeaders = (
  payloadHeaders: string[],
  rows: string[][],
  fallbackPrefix: string
): string[] => {
  const count = Math.max(payloadHeaders.length, maxColumnCount(rows), 1);
  return Array.from({ length: count }, (_, i) => payloadHeaders[i] ?? `${fallbackPrefix} ${i + 1}`);
};

const rowKey = (row: string[]): string => JSON.stringify(row.map((cell) => cell ?? ''));

const buildRowCountMap = (rows: string[][]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

const countPreviewDiffRows = (left: string[][], right: string[][]): number => {
  const rightMap = buildRowCountMap(right);
  let unmatched = 0;

  for (const row of left) {
    const key = rowKey(row);
    const count = rightMap.get(key) ?? 0;
    if (count > 0) {
      rightMap.set(key, count - 1);
    } else {
      unmatched += 1;
    }
  }

  for (const remaining of rightMap.values()) {
    unmatched += remaining;
  }

  return unmatched;
};

const getRowMismatchFlags = (rows: string[][], peerRows: string[][]): boolean[] => {
  const peerMap = buildRowCountMap(peerRows);

  return rows.map((row) => {
    const key = rowKey(row);
    const count = peerMap.get(key) ?? 0;
    if (count > 0) {
      peerMap.set(key, count - 1);
      return false;
    }
    return true;
  });
};

export default function WidgetComparePage() {
  const router = useRouter();
  const { setQaState, resetQa } = useQa();
  const resultsRef = useRef<HTMLDivElement>(null);

  const [inputs, setInputs] = useState<QaInputs>(EMPTY_INPUTS);

  const [regularData, setRegularData] = useState<WidgetPayload | null>(null);
  const [refactorData, setRefactorData] = useState<WidgetPayload | null>(null);
  const [comparisonReport, setComparisonReport] = useState<ComparisonItem[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<Environment, string[][]>>({
    regular: [],
    refactor: [],
  });

  const [loading, setLoading] = useState({
    regular: false,
    refactor: false,
    compare: false,
    previewRegular: false,
    previewRefactor: false,
  });
  const [error, setError] = useState('');
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [hasCompared, setHasCompared] = useState(false);

  const resetWidgetPageState = useCallback(() => {
    setInputs(EMPTY_INPUTS);
    setRegularData(null);
    setRefactorData(null);
    setComparisonReport([]);
    setPreviewRows({ regular: [], refactor: [] });
    setLoading({
      regular: false,
      refactor: false,
      compare: false,
      previewRegular: false,
      previewRefactor: false,
    });
    setError('');
    setShowDiffOnly(false);
    setHasCompared(false);
    resetQa();
  }, [resetQa]);

  useEffect(() => {
    // Ensure browser back-cache restores do not keep stale input/results.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resetWidgetPageState();
    };

    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [resetWidgetPageState]);

  const filteredReport = useMemo(
    () => (showDiffOnly ? comparisonReport.filter((r) => !r.isMatch) : comparisonReport),
    [comparisonReport, showDiffOnly]
  );
  const previewDiffCount = useMemo(
    () => countPreviewDiffRows(previewRows.regular, previewRows.refactor),
    [previewRows]
  );
  const canExportPreviewCsv = previewRows.regular.length > 0 && previewRows.refactor.length > 0;
  const legacyPreviewHeaders = useMemo(
    () => getPreviewHeadersFromPayload((regularData as WidgetPayloadTyped | null) ?? null),
    [regularData]
  );
  const refactorPreviewHeaders = useMemo(
    () => getPreviewHeadersFromPayload((refactorData as WidgetPayloadTyped | null) ?? null),
    [refactorData]
  );

  const getFullComparison = (
    obj1: JsonValue | undefined,
    obj2: JsonValue | undefined,
    path = ''
  ): ComparisonItem[] => {
    if (isLeafValue(obj1) || isLeafValue(obj2)) {
      return [
        {
          path: path || 'root',
          regularValue: obj1,
          refactorValue: obj2,
          isMatch: stableStringify(obj1) === stableStringify(obj2),
        },
      ];
    }

    const left = (obj1 ?? {}) as Record<string, JsonValue>;
    const right = (obj2 ?? {}) as Record<string, JsonValue>;
    const allKeys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)]));

    return allKeys.flatMap((key) => {
      const currentPath = path ? `${path}.${key}` : key;
      return getFullComparison(left[key], right[key], currentPath);
    });
  };

  const handleInputChange = (field: keyof QaInputs, value: string) => {
    setInputs((prev) => ({ ...prev, [field]: value }));
  };

  const handleFetch = async (env: Environment) => {
    const isReg = env === 'regular';
    const config = isReg
      ? { url: inputs.regUrl, token: inputs.regToken, dId: inputs.regDashId, wId: inputs.regWidgetId }
      : { url: inputs.refUrl, token: inputs.refToken, dId: inputs.refDashId, wId: inputs.refWidgetId };

    if (!isValidHttpUrl(config.url.trim()) || !config.token.trim() || !config.dId.trim() || !config.wId.trim()) {
      setError(`Valid URL, token, dashboard ID and widget ID are required for ${env}.`);
      return;
    }

    setError('');
    setLoading((prev) => ({ ...prev, [env]: true }));

    try {
      const res = await fetch('/api/widget/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url.trim(),
          token: config.token.trim(),
          dashboardId: config.dId.trim(),
          widgetId: config.wId.trim(),
          environment: env,
        }),
      });

      const json = (await res.json()) as { error?: string; data?: WidgetPayload };
      if (!res.ok || !json.data) throw new Error(json.error || 'Fetch failed');

      const typedPayload = json.data as WidgetPayloadTyped;
      const jaqlBody = prepareJaqlBody(typedPayload);
      const expectedColumns =
        getPanelItems(asPanels(typedPayload.panels), 'rows').length +
        getPanelItems(asPanels(typedPayload.panels), 'values').length;

      if (isReg) {
        setRegularData(json.data);
      } else {
        setRefactorData(json.data);
      }

      setLoading((prev) => ({
        ...prev,
        [isReg ? 'previewRegular' : 'previewRefactor']: true,
      }));

      if (jaqlBody && typedPayload.datasource?.fullname) {
        try {
          const previewRes = await fetch('/api/widget/jaql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseUrl: config.url.trim(),
              token: config.token.trim(),
              datasource: typedPayload.datasource.fullname,
              jaql: jaqlBody,
            }),
          });

          const previewJson = (await previewRes.json()) as {
            data?: { values?: unknown };
            error?: string;
          };

          if (previewRes.ok && previewJson.data) {
            const normalized = normalizePreviewRows(
              previewJson.data.values,
              expectedColumns > 0 ? expectedColumns : 1
            );
            setPreviewRows((prev) => ({ ...prev, [env]: normalized }));
          } else {
            setPreviewRows((prev) => ({ ...prev, [env]: [] }));
          }
        } finally {
          setLoading((prev) => ({
            ...prev,
            [isReg ? 'previewRegular' : 'previewRefactor']: false,
          }));
        }
      } else {
        setPreviewRows((prev) => ({ ...prev, [env]: [] }));
        setLoading((prev) => ({
          ...prev,
          [isReg ? 'previewRegular' : 'previewRefactor']: false,
        }));
      }

      setHasCompared(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading((prev) => ({ ...prev, [env]: false }));
    }
  };

  const runComparison = () => {
    if (!regularData || !refactorData) return;
    setLoading((prev) => ({ ...prev, compare: true }));

    const report = getFullComparison(regularData, refactorData);
    setComparisonReport(report);
    setHasCompared(true);
    setLoading((prev) => ({ ...prev, compare: false }));

    setQaState((prev) => ({
      ...prev,
      inputs,
      regularData,
      refactorData,
      comparisonReport: report,
      phase: 'DATA_AUDIT_PENDING',
      createdAt: new Date().toISOString(),
    }));

    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleExportCSV = () => {
    const headers = ['Status', 'Path', 'Legacy Value', 'Refactor Value'].join(',');
    const rows = comparisonReport
      .map((r) => [
        r.isMatch ? 'MATCH' : 'DIFF',
        `"${r.path}"`,
        `"${JSON.stringify(r.regularValue)?.replace(/"/g, '""')}"`,
        `"${JSON.stringify(r.refactorValue)?.replace(/"/g, '""')}"`,
      ].join(','))
      .join('\n');

    const blob = new Blob([`${headers}\n${rows}`], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Audit_Report_${Date.now()}.csv`;
    link.click();
  };

  const handleExportPreviewCompareCsv = () => {
    const legacyRows = previewRows.regular;
    const refRows = previewRows.refactor;

    if (!canExportPreviewCsv) {
      return;
    }

    const legacyCols = buildDynamicHeaders(legacyPreviewHeaders, legacyRows, 'Legacy Col');
    const refCols = buildDynamicHeaders(refactorPreviewHeaders, refRows, 'Refactor Col');

    const refMap = new Map<string, string[][]>();
    for (const row of refRows) {
      const key = rowKey(row);
      const bucket = refMap.get(key) ?? [];
      bucket.push(row);
      refMap.set(key, bucket);
    }

    const paired: Array<{ status: 'MATCH' | 'MISMATCH'; legacy: string[]; refactor: string[] }> = [];

    for (const legacyRow of legacyRows) {
      const key = rowKey(legacyRow);
      const bucket = refMap.get(key);
      if (bucket && bucket.length > 0) {
        const matchedRef = bucket.shift() as string[];
        paired.push({ status: 'MATCH', legacy: legacyRow, refactor: matchedRef });
      } else {
        paired.push({ status: 'MISMATCH', legacy: legacyRow, refactor: [] });
      }
    }

    for (const remainingRows of refMap.values()) {
      for (const refRow of remainingRows) {
        paired.push({ status: 'MISMATCH', legacy: [], refactor: refRow });
      }
    }

    const headers = [
      'Status',
      'Legacy Row Key',
      'Refactor Row Key',
      ...legacyCols.map((h) => `Legacy - ${h}`),
      ...refCols.map((h) => `Refactor - ${h}`),
    ];

    const rows = paired.map((item) => {
      const legacyCells = legacyCols.map((_, i) => item.legacy[i] ?? '');
      const refCells = refCols.map((_, i) => item.refactor[i] ?? '');
      return [
        item.status,
        item.legacy.length ? rowKey(item.legacy) : '',
        item.refactor.length ? rowKey(item.refactor) : '',
        ...legacyCells,
        ...refCells,
      ]
        .map(csvEscape)
        .join(',');
    });

    const csv = [headers.map(csvEscape).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Widget_Preview_SideBySide_${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-20 font-sans">
      <AppHeader
        title="DXC Quality Lab"
        subtitle="Widget Compare"
        onBackClick={() => {
          resetWidgetPageState();
          router.push('/');
        }}
      />

      <main className="max-w-7xl mx-auto p-8 space-y-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {(['regular', 'refactor'] as Environment[]).map((env) => {
            const isReg = env === 'regular';
            const isEnvLoading = isReg ? loading.regular : loading.refactor;
            const prefix = isReg ? 'reg' : 'ref';

            return (
              <div key={env} className="space-y-6">
                <section className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-sm">
                  <h2 className={`text-xs font-black uppercase mb-6 flex items-center gap-2 ${isReg ? 'text-rose-500' : 'text-emerald-500'}`}>
                    <Database size={14} /> {isReg ? 'Source: Legacy (Old)' : 'Target: Refactor (New)'}
                  </h2>
                  <div className="space-y-3">
                    <InputField
                      placeholder="API Base URL"
                      value={inputs[`${prefix}Url` as keyof QaInputs]}
                      onChange={(v) => handleInputChange(`${prefix}Url` as keyof QaInputs, v)}
                    />
                    <InputField
                      placeholder="Bearer Token"
                      type="password"
                      value={inputs[`${prefix}Token` as keyof QaInputs]}
                      onChange={(v) => handleInputChange(`${prefix}Token` as keyof QaInputs, v)}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField
                        placeholder="Dashboard ID"
                        value={inputs[`${prefix}DashId` as keyof QaInputs]}
                        onChange={(v) => handleInputChange(`${prefix}DashId` as keyof QaInputs, v)}
                      />
                      <InputField
                        placeholder="Widget ID"
                        value={inputs[`${prefix}WidgetId` as keyof QaInputs]}
                        onChange={(v) => handleInputChange(`${prefix}WidgetId` as keyof QaInputs, v)}
                      />
                    </div>
                    <button
                      onClick={() => handleFetch(env)}
                      disabled={isEnvLoading}
                      className={`w-full py-4 rounded-2xl text-white font-black text-xs uppercase tracking-widest transition-all active:scale-95 ${isReg ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'} disabled:opacity-50 shadow-lg shadow-slate-100`}
                    >
                      {isEnvLoading ? 'Fetching Data...' : `Fetch ${env} payload`}
                    </button>
                  </div>
                </section>
              </div>
            );
          })}
        </div>

        <section className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-700">Widget Preview</h2>
              <p className="text-xs text-slate-500">
                Native pivot preview generated from payload + live JAQL rows.
              </p>
            </div>
            <button
              onClick={handleExportPreviewCompareCsv}
              disabled={!canExportPreviewCsv}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                canExportPreviewCsv
                  ? 'bg-slate-900 text-white hover:bg-blue-600'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              Export Side-by-Side CSV
            </button>
          </div>
          {!canExportPreviewCsv && (
            <p className="text-[11px] text-slate-400 mb-3">
              Export will be enabled after both Legacy and Refactor preview rows are loaded.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PreviewSideCard label="Legacy Preview" tone="rose">
              {!regularData ? (
                <div className="h-[280px] flex items-center justify-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
                  Fetch legacy payload to generate preview.
                </div>
              ) : (
                <WidgetNaturalPreview
                  payload={regularData as WidgetPayloadTyped}
                  queryRows={previewRows.regular}
                  queryLoading={loading.previewRegular}
                  peerRows={previewRows.refactor}
                />
              )}
            </PreviewSideCard>

            <PreviewSideCard label="Refactor Preview" tone="emerald">
              {!refactorData ? (
                <div className="h-[280px] flex items-center justify-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
                  Fetch refactor payload to generate preview.
                </div>
              ) : (
                <WidgetNaturalPreview
                  payload={refactorData as WidgetPayloadTyped}
                  queryRows={previewRows.refactor}
                  queryLoading={loading.previewRefactor}
                  peerRows={previewRows.regular}
                />
              )}
            </PreviewSideCard>
          </div>

          {(previewRows.regular.length > 0 || previewRows.refactor.length > 0) && (
            <div className="mt-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Preview Diff Rows:
              <span className={`ml-2 ${previewDiffCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {previewDiffCount}
              </span>
            </div>
          )}
        </section>

        {(regularData || refactorData) && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {([
              { env: 'regular' as const, data: regularData, label: 'Legacy Widget' },
              { env: 'refactor' as const, data: refactorData, label: 'Refactor Widget' },
            ]).map(({ env, data, label }) => (
              <div key={env} className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm p-6">
                <div className="mb-4 flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2 italic">
                    <FileJson size={14} className="text-blue-500" /> Payload Received
                  </span>
                </div>
                <PayloadView data={data} title={label} />
              </div>
            ))}
          </section>
        )}

        <div className="flex flex-col items-center justify-center py-12 border-y border-slate-200">
          <button
            onClick={runComparison}
            disabled={!regularData || !refactorData || loading.compare}
            className="group px-16 py-6 bg-blue-600 text-white rounded-[2rem] font-black text-xl shadow-2xl shadow-blue-200 transition-all hover:-translate-y-1 active:scale-95 flex items-center gap-4 disabled:bg-slate-300 disabled:shadow-none"
          >
            <Zap className={loading.compare ? 'animate-pulse' : ''} fill="currentColor" />
            {loading.compare ? 'ANALYZING PAYLOADS...' : 'RUN FULL AUDIT COMPARISON'}
          </button>
          {error && (
            <p className="mt-4 text-rose-600 font-bold bg-rose-50 px-4 py-2 rounded-xl border border-rose-100 flex items-center gap-2">
              <XCircle size={16} /> {error}
            </p>
          )}
        </div>

        {hasCompared && (
          <div ref={resultsRef} className="space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-700">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <StatCard label="Total Audit Points" val={comparisonReport.length} icon={<Search className="text-slate-300" />} />
              <StatCard
                label="Mismatches"
                val={comparisonReport.filter((r) => !r.isMatch).length}
                color="text-rose-600"
                icon={<XCircle className="text-rose-400" />}
              />
              <StatCard
                label="Matches"
                val={comparisonReport.filter((r) => r.isMatch).length}
                color="text-emerald-600"
                icon={<CheckCircle2 className="text-emerald-400" />}
              />
              <div className="bg-white p-8 rounded-[2rem] border border-slate-200 flex flex-col justify-center items-center gap-2">
                <p className="text-[10px] font-black uppercase text-slate-400">View Filter</p>
                <button
                  onClick={() => setShowDiffOnly(!showDiffOnly)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${showDiffOnly ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}`}
                >
                  <Filter size={14} /> {showDiffOnly ? 'Diff Only' : 'Show All'}
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-xl overflow-hidden">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-20">
                <h3 className="font-black text-2xl italic text-slate-800">Audit Logs</h3>
                <button
                  onClick={handleExportCSV}
                  className="bg-slate-900 text-white px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-blue-600 transition-all shadow-lg shadow-slate-200"
                >
                  <Download size={14} /> Export CSV
                </button>
              </div>

              <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr className="border-b">
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Status</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Object Path</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Legacy Value</th>
                      <th className="p-6 text-[10px] font-black uppercase text-slate-400 tracking-widest">Refactor Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredReport.map((r, i) => (
                      <tr key={i} className={`group hover:bg-slate-50 transition-colors ${!r.isMatch ? 'bg-rose-50/20' : ''}`}>
                        <td className="p-6">
                          <span
                            className={`inline-flex items-center gap-1 text-[9px] font-black px-2.5 py-1 rounded-full border ${
                              r.isMatch
                                ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                : 'bg-rose-100 text-rose-700 border-rose-200'
                            }`}
                          >
                            {r.isMatch ? 'MATCH' : 'DIFF'}
                          </span>
                        </td>
                        <td className="p-6">
                          <div className="flex items-center gap-2">
                            <code className="text-[11px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">
                              {r.path}
                            </code>
                            <button
                              onClick={() => navigator.clipboard.writeText(r.path)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-500"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="p-6 text-[11px] font-mono text-slate-500 max-w-[380px] whitespace-pre-wrap break-all align-top">
                          {JSON.stringify(r.regularValue, null, 2)}
                        </td>
                        <td className={`p-6 text-[11px] font-mono max-w-[380px] whitespace-pre-wrap break-all align-top ${!r.isMatch ? 'text-rose-600 font-black' : 'text-slate-500'}`}>
                          {JSON.stringify(r.refactorValue, null, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}

interface InputFieldProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}

function InputField({ onChange, ...props }: InputFieldProps) {
  return (
    <input
      {...props}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
    />
  );
}

interface StatCardProps {
  label: string;
  val: number;
  icon: ReactNode;
  color?: string;
}

function StatCard({ label, val, icon, color = 'text-slate-800' }: StatCardProps) {
  return (
    <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm flex items-center justify-between transition-transform hover:scale-[1.02]">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">{label}</p>
        <p className={`text-4xl font-black ${color}`}>{val}</p>
      </div>
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner">{icon}</div>
    </div>
  );
}

function asPanels(value: JsonValue | undefined): WidgetPanel[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as WidgetPanel[];
}

function getPanelItems(panels: WidgetPanel[], panelName: string): WidgetPanelItem[] {
  const panel = panels.find((p) => p.name === panelName);
  return panel?.items ?? [];
}

function jaqlLabel(item: WidgetPanelItem): string {
  const jaql = item.jaql;
  if (!jaql) return 'Unnamed';
  return jaql.title || jaql.dim || jaql.formula || 'Unnamed';
}

function WidgetNaturalPreview({
  payload,
  queryRows,
  queryLoading,
  peerRows,
}: {
  payload: WidgetPayloadTyped;
  queryRows: string[][];
  queryLoading: boolean;
  peerRows: string[][];
}) {
  const widgetType = typeof payload.widgetType === 'string' ? payload.widgetType : 'unknown';
  const widgetSubType = typeof payload.widgetSubType === 'string' ? payload.widgetSubType : 'unknown';
  const panels = asPanels(payload.panels);

  const rows = getPanelItems(panels, 'rows');
  const values = getPanelItems(panels, 'values');
  const filters = getPanelItems(panels, 'filters');

  if (widgetType.includes('pivot')) {
    return (
      <PivotWidgetPreview
        widgetType={widgetType}
        widgetSubType={widgetSubType}
        rows={rows}
        values={values}
        filters={filters}
        queryRows={queryRows}
        queryLoading={queryLoading}
        peerRows={peerRows}
      />
    );
  }

  return (
    <div className="p-4 bg-white">
      <div className="text-xs text-slate-500 mb-3">
        Widget type <span className="font-bold text-slate-700">{widgetType}</span> is not yet mapped to a native renderer.
      </div>
      <div className="text-[11px] text-slate-600">
        Using metadata summary for now. You can still compare payload values and audit output data below.
      </div>
    </div>
  );
}

function PivotWidgetPreview({
  widgetType,
  widgetSubType,
  rows,
  values,
  filters,
  queryRows,
  queryLoading,
  peerRows,
}: {
  widgetType: string;
  widgetSubType: string;
  rows: WidgetPanelItem[];
  values: WidgetPanelItem[];
  filters: WidgetPanelItem[];
  queryRows: string[][];
  queryLoading: boolean;
  peerRows: string[][];
}) {
  const headers = [...rows.map(jaqlLabel), ...values.map(jaqlLabel)];
  const allMembers = filters.flatMap((item) => item.jaql?.filter?.members ?? []);

  const fallbackRows = allMembers.map((member) => {
    const rowCells = rows.map((_, idx) => (idx === 0 ? member : 'Closed'));
    const valueCells = values.map(() => '');
    return [...rowCells, ...valueCells];
  });
  const tableRows = queryRows.length > 0 ? queryRows : fallbackRows;
  const rowMismatchFlags = getRowMismatchFlags(tableRows, peerRows);

  return (
    <div className="p-1 bg-white">
      <div className="rounded-md border border-slate-300 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-100 border-b border-slate-300">
            <tr>
              {headers.length === 0 ? (
                <th className="text-left p-2 font-semibold text-slate-600">No mapped rows/values found</th>
              ) : (
                headers.map((head) => (
                  <th key={head} className="text-left p-2 font-semibold text-slate-600 whitespace-nowrap border-r border-slate-300 last:border-r-0">
                    {head}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {queryLoading && headers.length > 0 && (
              <tr>
                <td colSpan={headers.length} className="p-3 text-slate-400 text-[12px] italic">
                  Loading live query rows...
                </td>
              </tr>
            )}
            {!queryLoading && headers.length > 0 && tableRows.length > 0 && tableRows.map((cells, rowIdx) => (
              <tr key={rowIdx} className="border-b border-slate-300 last:border-b-0">
                {cells.map((cell, colIdx) => (
                  <td
                    key={`${rowIdx}-${colIdx}`}
                    className={`p-2 border-r border-slate-300 last:border-r-0 ${
                      rowMismatchFlags[rowIdx]
                        ? 'text-rose-700 bg-rose-50/60 font-semibold'
                        : 'text-slate-700'
                    }`}
                  >
                    {cell || ''}
                  </td>
                ))}
              </tr>
            ))}
            {!queryLoading && headers.length > 0 && tableRows.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="p-3 text-slate-400 text-[12px] italic">
                  No rows returned from preview query for this widget.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-widest text-slate-400 font-bold">
        {widgetType} / {widgetSubType}
      </div>
    </div>
  );
}

function PreviewSideCard({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'rose' | 'emerald';
  children: ReactNode;
}) {
  const chipClass =
    tone === 'rose'
      ? 'text-rose-700 border-rose-200 bg-rose-50'
      : 'text-emerald-700 border-emerald-200 bg-emerald-50';

  return (
    <div className="border border-slate-200 rounded-2xl p-4 bg-white">
      <div className="mb-3">
        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded border ${chipClass}`}>
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
