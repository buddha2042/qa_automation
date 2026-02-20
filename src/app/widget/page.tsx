'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQa, QaInputs } from '@/context/QaContext';
import PayloadView from '@/components/PayloadView';
import AppHeader from '@/components/AppHeader';
import { XCircle, Zap, FileJson } from 'lucide-react';
import InputField from './components/InputField';
import CompareResults from './components/CompareResults';
import {
  BASE_URL_PRESET_OPTIONS,
  getPresetFromUrl,
  getUrlForPreset,
  type BaseUrlPreset,
  type Environment as UrlEnvironment,
  SISENSE_BASE_URLS,
} from '@/lib/sisenseEnvironments';
import {
  type Environment,
  type JsonValue,
  type ComparisonItem,
  type WidgetPayload,
  type WidgetPanel,
  type WidgetPanelItem,
  type WidgetPayloadTyped,
} from './types';

const EMPTY_INPUTS: QaInputs = {
  regUrl: SISENSE_BASE_URLS.regular,
  regToken: '',
  regDashId: '',
  regWidgetId: '',
  refUrl: SISENSE_BASE_URLS.refactor,
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

const IGNORED_COMPARE_PATHS = new Set(['style.content.html']);

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
  count?: number;
  metadata: Array<{
    jaql: WidgetPanelItem['jaql'];
    panel: string | undefined;
    disabled?: boolean;
    instanceid?: string;
    field?: {
      id?: string;
      index?: number;
    };
  }>;
}

const prepareJaqlBody = (widgetJson: WidgetPayloadTyped): PreviewQueryBody | null => {
  const panels = asPanels(widgetJson.panels);
  const panelMetadata =
    panels.length > 0
      ? panels.flatMap((panel) =>
          (panel.items ?? []).map((item) => ({
            jaql: item.jaql,
            panel: panel.name,
            disabled: item.disabled,
          }))
        )
      : [];

  const rawMetadata =
    panelMetadata.length === 0 && Array.isArray(widgetJson.metadata)
      ? widgetJson.metadata
          .filter((item) => item.jaql)
          .map((item) => ({
            jaql: item.jaql,
            panel: item.panel,
            disabled: item.disabled,
            instanceid: item.instanceid,
            field: item.field,
          }))
      : [];

  const metadata = [...panelMetadata, ...rawMetadata].filter(
    (item) => item.jaql && !item.disabled
  );

  if (metadata.length === 0) return null;

  const fallbackDatasource =
    widgetJson.datasource?.fullname ??
    widgetJson.query?.datasource?.fullname ??
    metadata.find((item) => item.jaql?.datasource?.fullname)?.jaql?.datasource?.fullname;

  return {
    datasource: fallbackDatasource ? { fullname: fallbackDatasource } : widgetJson.datasource,
    count: widgetJson.query?.count ?? 1000,
    metadata,
  };
};

const resolveDatasourceFullname = (
  widgetJson: WidgetPayloadTyped,
  jaqlBody: PreviewQueryBody | null
): string | null =>
  widgetJson.datasource?.fullname?.trim() ||
  widgetJson.query?.datasource?.fullname?.trim() ||
  jaqlBody?.datasource?.fullname?.trim() ||
  jaqlBody?.metadata.find((item) => item.jaql?.datasource?.fullname)?.jaql?.datasource?.fullname?.trim() ||
  null;

const getExpectedPreviewColumns = (payload: WidgetPayloadTyped): number => {
  const panels = asPanels(payload.panels);
  const fromPanels =
    getPanelItems(panels, 'rows').length + getPanelItems(panels, 'values').length;
  if (fromPanels > 0) return fromPanels;

  if (!Array.isArray(payload.metadata)) return 0;
  return payload.metadata.filter(
    (item) => !item.disabled && (item.panel === 'rows' || item.panel === 'values')
  ).length;
};

const getEnvConfig = (inputs: QaInputs, env: Environment) =>
  env === 'regular'
    ? {
        url: inputs.regUrl.trim(),
        token: inputs.regToken.trim(),
      }
    : {
        url: inputs.refUrl.trim(),
        token: inputs.refToken.trim(),
      };

const hasQueryMetadata = (payload: WidgetPayloadTyped): boolean =>
  Array.isArray(payload.query?.metadata) && payload.query.metadata.length > 0;

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

export default function WidgetComparePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setQaState, resetQa } = useQa();
  const widgetPreviewRef = useRef<HTMLElement>(null);

  const [inputs, setInputs] = useState<QaInputs>(EMPTY_INPUTS);
  const [urlPresets, setUrlPresets] = useState<Record<UrlEnvironment, BaseUrlPreset>>({
    regular: 'regular',
    refactor: 'refactor',
  });

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
  const isComparisonRunning =
    loading.compare || loading.previewRegular || loading.previewRefactor;

  const resetWidgetPageState = useCallback(() => {
    setInputs(EMPTY_INPUTS);
    setUrlPresets({ regular: 'regular', refactor: 'refactor' });
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

  useEffect(() => {
    const prefillKey = searchParams.get('prefillKey');
    if (!prefillKey) return;

    const raw = localStorage.getItem(prefillKey);
    if (!raw) {
      router.replace('/widget');
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<QaInputs>;
      const prefilledInputs: QaInputs = {
        ...EMPTY_INPUTS,
        regUrl: typeof parsed.regUrl === 'string' ? parsed.regUrl : '',
        regToken: typeof parsed.regToken === 'string' ? parsed.regToken : '',
        regDashId: typeof parsed.regDashId === 'string' ? parsed.regDashId : '',
        regWidgetId: typeof parsed.regWidgetId === 'string' ? parsed.regWidgetId : '',
        refUrl: typeof parsed.refUrl === 'string' ? parsed.refUrl : '',
        refToken: typeof parsed.refToken === 'string' ? parsed.refToken : '',
        refDashId: typeof parsed.refDashId === 'string' ? parsed.refDashId : '',
        refWidgetId: typeof parsed.refWidgetId === 'string' ? parsed.refWidgetId : '',
      };

      setInputs(prefilledInputs);
      setUrlPresets({
        regular: getPresetFromUrl(prefilledInputs.regUrl),
        refactor: getPresetFromUrl(prefilledInputs.refUrl),
      });
      setQaState((prev) => ({
        ...prev,
        inputs: prefilledInputs,
        phase: 'WIDGET_QA_RUNNING',
        createdAt: new Date().toISOString(),
      }));
    } catch {
      // Ignore malformed prefill payload and keep page usable.
    } finally {
      localStorage.removeItem(prefillKey);
      router.replace('/widget');
    }
  }, [searchParams, router, setQaState]);

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
    if (path && IGNORED_COMPARE_PATHS.has(path)) {
      return [];
    }

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

  const handleUrlPresetChange = (env: UrlEnvironment, preset: BaseUrlPreset) => {
    setUrlPresets((prev) => ({ ...prev, [env]: preset }));
    const field: keyof QaInputs = env === 'regular' ? 'regUrl' : 'refUrl';
    setInputs((prev) => ({
      ...prev,
      [field]: getUrlForPreset(preset, prev[field]),
    }));
  };

  const handleUrlInputChange = (env: UrlEnvironment, value: string) => {
    const field: keyof QaInputs = env === 'regular' ? 'regUrl' : 'refUrl';
    setInputs((prev) => ({ ...prev, [field]: value }));
    setUrlPresets((prev) => ({ ...prev, [env]: getPresetFromUrl(value) }));
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

      if (isReg) {
        setRegularData(json.data);
        setPreviewRows((prev) => ({ ...prev, regular: [] }));
      } else {
        setRefactorData(json.data);
        setPreviewRows((prev) => ({ ...prev, refactor: [] }));
      }

      setHasCompared(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading((prev) => ({ ...prev, [env]: false }));
    }
  };

  const fetchPreviewForEnv = async (env: Environment, payload: WidgetPayloadTyped) => {
    const loadingKey = env === 'regular' ? 'previewRegular' : 'previewRefactor';
    const config = getEnvConfig(inputs, env);
    const jaqlBody = prepareJaqlBody(payload);
    const expectedColumns = getExpectedPreviewColumns(payload);
    const datasourceFullname = resolveDatasourceFullname(payload, jaqlBody);

    setLoading((prev) => ({ ...prev, [loadingKey]: true }));

    try {
      if (!isValidHttpUrl(config.url) || !config.token) {
        setPreviewRows((prev) => ({ ...prev, [env]: [] }));
        setError(`${env} preview query skipped: missing API URL or token.`);
        return;
      }

      if (hasQueryMetadata(payload)) {
        const fullDataRes = await fetch('/api/widget/fetch-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: config.url,
            token: config.token,
            widgetPayload: payload,
          }),
        });

        const fullDataJson = (await fullDataRes.json()) as {
          data?: unknown;
          error?: string;
          rowCount?: number;
        };

        if (fullDataRes.ok && Array.isArray(fullDataJson.data)) {
          const normalized = normalizePreviewRows(
            fullDataJson.data,
            expectedColumns > 0 ? expectedColumns : 1
          );
          setPreviewRows((prev) => ({ ...prev, [env]: normalized }));
          return;
        }

        setPreviewRows((prev) => ({ ...prev, [env]: [] }));
        setError(
          `${env} preview (full query) failed: ${
            fullDataJson.error ?? 'no data returned from widget query endpoint'
          }`
        );
        return;
      }

      if (!jaqlBody || !datasourceFullname) {
        setPreviewRows((prev) => ({ ...prev, [env]: [] }));
        setError(`${env} preview query skipped: datasource/metadata missing in payload.`);
        return;
      }

      const previewRes = await fetch('/api/widget/jaql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: config.url,
          token: config.token,
          datasource: datasourceFullname,
          jaql: {
            ...jaqlBody,
            count: jaqlBody.count ?? 1000,
          },
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
        setError(`${env} preview query failed: ${previewJson.error ?? 'unknown error'}`);
      }
    } finally {
      setLoading((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const runComparison = async () => {
    if (!regularData || !refactorData) return;
    setLoading((prev) => ({ ...prev, compare: true }));
    setError('');

    try {
      const report = getFullComparison(regularData, refactorData);
      setComparisonReport(report);
      setHasCompared(true);

      setQaState((prev) => ({
        ...prev,
        inputs,
        regularData,
        refactorData,
        comparisonReport: report,
        phase: 'DATA_AUDIT_PENDING',
        createdAt: new Date().toISOString(),
      }));

      setTimeout(() => widgetPreviewRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

      await Promise.all([
        fetchPreviewForEnv('regular', regularData as WidgetPayloadTyped),
        fetchPreviewForEnv('refactor', refactorData as WidgetPayloadTyped),
      ]);
    } finally {
      setLoading((prev) => ({ ...prev, compare: false }));
    }
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
                  <div className="space-y-3">
                    <select
                      value={urlPresets[env]}
                      onChange={(e) => handleUrlPresetChange(env, e.target.value as BaseUrlPreset)}
                      className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    >
                      {BASE_URL_PRESET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <InputField
                      placeholder="Manual API Base URL"
                      value={inputs[`${prefix}Url` as keyof QaInputs]}
                      onChange={(v) => handleUrlInputChange(env, v)}
                      disabled={urlPresets[env] !== 'manual'}
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
          {isComparisonRunning && (
            <p className="mt-3 text-xs font-semibold text-slate-500">
              Running comparison and loading widget preview rows...
            </p>
          )}
          {error && (
            <p className="mt-4 text-rose-600 font-bold bg-rose-50 px-4 py-2 rounded-xl border border-rose-100 flex items-center gap-2">
              <XCircle size={16} /> {error}
            </p>
          )}
        </div>

        <CompareResults
          hasCompared={hasCompared}
          widgetPreviewRef={widgetPreviewRef}
          canExportPreviewCsv={canExportPreviewCsv}
          onExportPreviewCompareCsv={handleExportPreviewCompareCsv}
          previewRows={previewRows}
          previewDiffCount={previewDiffCount}
          regularData={(regularData as WidgetPayloadTyped | null) ?? null}
          refactorData={(refactorData as WidgetPayloadTyped | null) ?? null}
          loadingPreviewRegular={loading.previewRegular}
          loadingPreviewRefactor={loading.previewRefactor}
          comparisonReport={comparisonReport}
          filteredReport={filteredReport}
          showDiffOnly={showDiffOnly}
          onToggleDiffOnly={() => setShowDiffOnly(!showDiffOnly)}
          onExportCSV={handleExportCSV}
        />
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
