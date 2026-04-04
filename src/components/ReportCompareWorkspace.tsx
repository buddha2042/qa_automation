'use client';

import { useEffect, useState } from 'react';
import type { ColumnMapping, CompareResult, WorkbookData, WorkbookSummary } from '@/lib/excelAudit';
import { SISENSE_BASE_URLS } from '@/lib/sisenseEnvironments';
import { AlertTriangle, ArrowDownUp, ChevronDown, ChevronUp, Database, FileSpreadsheet, Upload } from 'lucide-react';

interface InspectResponse {
  workbooks: {
    left?: WorkbookSummary;
    right?: WorkbookSummary;
  };
}

interface SisenseDashboardOption {
  dashboardId: string;
  title: string;
  widgets: Array<{
    widgetId: string;
    title: string;
  }>;
}

interface SisenseWidgetResponse {
  workbook: WorkbookSummary;
  workbookData: WorkbookData;
  warning?: string;
}

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const UI_NULL_TOKENS = new Set(['', '-', 'na', 'n/a', 'null', 'none', 'nil', '""', "''", '/', '\\']);
const EXCEL_AUDIT_SISENSE_STORAGE_KEY = 'excel-audit-sisense-config';
const MIN_EXCEL_SERIAL_DAY = 20000;
const MAX_EXCEL_SERIAL_DAY = 80000;

const createMapping = (left = '', right = ''): ColumnMapping => ({ left, right });

const excelSerialToIsoDate = (value: number) => {
  if (!Number.isInteger(value) || value < MIN_EXCEL_SERIAL_DAY || value > MAX_EXCEL_SERIAL_DAY) return null;
  const utcMillis = Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000;
  return new Date(utcMillis).toISOString().slice(0, 10);
};

const parseDateLikeForUi = (value: string) => {
  const text = value.trim();
  if (!text) return null;

  const numeric = Number(text.replace(/,/g, ''));
  if (!Number.isNaN(numeric)) {
    const excelDate = excelSerialToIsoDate(numeric);
    if (excelDate) return excelDate;
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    const normalizedYear = year.length === 2 ? `20${year}` : year;
    return `${normalizedYear.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
};

const autoMatchColumns = (leftHeaders: string[], rightHeaders: string[]): ColumnMapping[] => {
  const rightLookup = new Map(
    rightHeaders
      .map((header) => [normalizeHeader(header), header] as const)
      .filter(([normalized]) => Boolean(normalized))
  );

  return leftHeaders
    .map((leftHeader) => {
      const normalizedLeftHeader = normalizeHeader(leftHeader);
      if (!normalizedLeftHeader) return null;

      const rightHeader = rightLookup.get(normalizedLeftHeader);
      return rightHeader ? createMapping(leftHeader, rightHeader) : null;
    })
    .filter((mapping): mapping is ColumnMapping => Boolean(mapping));
};

const hasMeaningfulPreviewCellForUi = (value: string) => {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return normalizeCellForUi(text) !== '__null__';
};

const columnHasMeaningfulPreviewDataForUi = (sheet: WorkbookSummary['sheets'][number] | undefined, header: string) => {
  if (!sheet) return false;
  const columnIndex = sheet.headers.indexOf(header);
  if (columnIndex < 0) return false;

  return sheet.previewRows.some((row) => hasMeaningfulPreviewCellForUi(row[columnIndex] ?? ''));
};

const filterMappingsWithPreviewDataForUi = (
  mappings: ColumnMapping[],
  leftSheet: WorkbookSummary['sheets'][number] | undefined,
  rightSheet: WorkbookSummary['sheets'][number] | undefined
) =>
  mappings.filter(
    (mapping) =>
      columnHasMeaningfulPreviewDataForUi(leftSheet, mapping.left) &&
      columnHasMeaningfulPreviewDataForUi(rightSheet, mapping.right)
  );

const appendWarningMessage = (current: string, next: string) => {
  const normalizedCurrent = current.trim();
  const normalizedNext = next.trim();
  if (!normalizedNext) return normalizedCurrent;
  if (!normalizedCurrent) return normalizedNext;
  if (normalizedCurrent.includes(normalizedNext)) return normalizedCurrent;
  return `${normalizedCurrent} ${normalizedNext}`;
};

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const formatWidgetOptionLabel = (widget: { widgetId: string; title: string }) => {
  const widgetId = widget.widgetId.trim();
  const widgetTitle = widget.title.trim();

  if (!widgetTitle) return widgetId;
  if (widgetTitle === widgetId) return widgetTitle;

  return `${widgetTitle} (${widgetId})`;
};

const normalizeCellForUi = (value: string) => {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (UI_NULL_TOKENS.has(text)) return '__null__';
  const withoutQuotes = text.replace(/["']/g, '').trim();
  if (!withoutQuotes) return '__null__';
  const normalizedNullToken = normalizeNullLikeTokenForUi(text);
  if (['na', 'null', 'none', 'nil'].includes(normalizedNullToken)) return '__null__';
  const numeric = Number(text.replace(/,/g, ''));
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    if (!Number.isInteger(numeric) && Math.trunc(numeric) >= MIN_EXCEL_SERIAL_DAY && Math.trunc(numeric) <= MAX_EXCEL_SERIAL_DAY) {
      return String(Math.trunc(numeric));
    }
    return String(Number.isInteger(numeric) ? Math.trunc(numeric) : Number(numeric.toFixed(10)));
  }
  const nameMask = nameMaskSignatureForUi(text);
  if (nameMask) return `__name__:${nameMask}`;
  return text;
};

const nameMaskSignatureForUi = (value: string) => {
  const tokens = value.toLowerCase().match(/[a-z]+/g);
  if (!tokens || tokens.length !== 2) return null;
  const masked = tokens
    .map((token) => token.replace(/[aeiou]/g, 'x'))
    .sort();
  return masked.join(' ');
};

const isEquivalentCellForUi = (left: string, right: string) => {
  const leftDate = parseDateLikeForUi(String(left ?? ''));
  const rightDate = parseDateLikeForUi(String(right ?? ''));
  if (leftDate && rightDate && leftDate === rightDate) return true;

  const normalizedLeft = normalizeCellForUi(left);
  const normalizedRight = normalizeCellForUi(right);
  if (normalizedLeft === normalizedRight) return true;

  const leftNameMask = nameMaskSignatureForUi(normalizedLeft);
  const rightNameMask = nameMaskSignatureForUi(normalizedRight);
  return Boolean(leftNameMask && rightNameMask && leftNameMask === rightNameMask);
};

export default function ReportCompareWorkspace() {
  const [leftFile, setLeftFile] = useState<File | null>(null);
  const [rightFile, setRightFile] = useState<File | null>(null);
  const [rightSourceMode, setRightSourceMode] = useState<'upload' | 'sisense'>('upload');
  const [workbooks, setWorkbooks] = useState<{ left?: WorkbookSummary; right?: WorkbookSummary }>({});
  const [sisenseWorkbookData, setSisenseWorkbookData] = useState<WorkbookData | null>(null);
  const [selectedSheets, setSelectedSheets] = useState({ left: '', right: '' });
  const [compareMappings, setCompareMappings] = useState<ColumnMapping[]>([]);
  const [sisenseConfig, setSisenseConfig] = useState({
    baseUrl: SISENSE_BASE_URLS.sisense_25_4_sp2,
    username: '',
    password: '',
    dashboardId: '',
    widgetId: '',
  });
  const [dashboards, setDashboards] = useState<SisenseDashboardOption[]>([]);
  const [error, setError] = useState('');
  const [inspectLoading, setInspectLoading] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [widgetLoading, setWidgetLoading] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareFilter, setCompareFilter] = useState<'mismatch' | 'match' | 'all'>('all');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [loadedSisenseSourceKey, setLoadedSisenseSourceKey] = useState('');
  const [warning, setWarning] = useState('');
  const [expandedTables, setExpandedTables] = useState({
    left: false,
    right: false,
  });

  const leftWorkbook = workbooks.left;
  const rightWorkbook = workbooks.right;
  const currentSisenseSourceKey = JSON.stringify({
    baseUrl: sisenseConfig.baseUrl.trim(),
    username: sisenseConfig.username.trim(),
    dashboardId: sisenseConfig.dashboardId,
    widgetId: sisenseConfig.widgetId,
  });
  const canInspect = Boolean(
    leftFile &&
      (rightSourceMode === 'upload'
        ? rightFile
        : sisenseWorkbookData && loadedSisenseSourceKey === currentSisenseSourceKey)
  );
  const canCompare = Boolean(leftFile && (rightSourceMode === 'upload' ? rightFile : sisenseWorkbookData) && compareMappings.length > 0);
  const selectedDashboard = dashboards.find((dashboard) => dashboard.dashboardId === sisenseConfig.dashboardId);
  const visibleComparisonRows =
    compareResult?.comparisonRows.filter((row) => {
      const statusMatches =
        compareFilter === 'all' ? true : compareFilter === 'match' ? row.status === 'MATCH' : row.status !== 'MATCH';
      if (!statusMatches) return false;

      return (compareResult?.matchedHeaders ?? []).every((mapping) => {
        const filterValue = columnFilters[mapping.left]?.trim().toLowerCase() ?? '';
        if (!filterValue) return true;

        const leftValue = String(row.leftValues[mapping.left] ?? '').toLowerCase();
        const rightValue = String(row.rightValues[mapping.right] ?? '').toLowerCase();
        return leftValue.includes(filterValue) || rightValue.includes(filterValue);
      });
    }) ?? [];
  const comparedLeftHeaders = compareResult?.matchedHeaders.map((mapping) => mapping.left) ?? [];
  const comparedRightHeaders = compareResult?.matchedHeaders.map((mapping) => mapping.right) ?? [];
  const ignoredLeftHeaders = compareResult?.left.headers.filter((header) => !comparedLeftHeaders.includes(header)) ?? [];
  const ignoredRightHeaders = compareResult?.right.headers.filter((header) => !comparedRightHeaders.includes(header)) ?? [];
  const resolvedCompareMappings = compareMappings.filter((mapping) => mapping.left && mapping.right);

  const exportComparisonCsv = () => {
    if (!compareResult) return;

    const headers = [
      'Status',
      'Left Row',
      'Right Row',
      ...compareResult.matchedHeaders.flatMap((mapping) => [`Left: ${mapping.left}`, `Right: ${mapping.right}`]),
    ];

    const escapeCsv = (value: string | number | null | undefined) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const rows = visibleComparisonRows.map((row) => [
      row.status,
      row.leftRowNumber ?? '',
      row.rightRowNumber ?? '',
      ...compareResult.matchedHeaders.flatMap((mapping) => [
        row.leftValues[mapping.left] ?? '',
        row.rightValues[mapping.right] ?? '',
      ]),
    ]);

    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comparison-${compareFilter}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXCEL_AUDIT_SISENSE_STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw) as {
        rightSourceMode?: 'upload' | 'sisense';
        baseUrl?: string;
        username?: string;
        password?: string;
        dashboardId?: string;
        widgetId?: string;
      };

      setRightSourceMode(saved.rightSourceMode === 'sisense' ? 'sisense' : 'upload');
      setSisenseConfig((current) => ({
        ...current,
        baseUrl: saved.baseUrl || current.baseUrl,
        username: saved.username || '',
        password: saved.password || '',
        dashboardId: saved.dashboardId || '',
        widgetId: saved.widgetId || '',
      }));
    } catch {
      // Ignore invalid persisted state and continue with defaults.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        EXCEL_AUDIT_SISENSE_STORAGE_KEY,
        JSON.stringify({
          rightSourceMode,
          baseUrl: sisenseConfig.baseUrl,
          username: sisenseConfig.username,
          password: sisenseConfig.password,
          dashboardId: sisenseConfig.dashboardId,
          widgetId: sisenseConfig.widgetId,
        })
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [rightSourceMode, sisenseConfig]);

  const handleInspect = async () => {
    if (!leftFile || (rightSourceMode === 'upload' && !rightFile) || (rightSourceMode === 'sisense' && !sisenseWorkbookData)) return;

    setInspectLoading(true);
    setError('');
    setWarning((current) =>
      current.includes('Some matched columns were excluded from preview')
        ? ''
        : current
    );
    setCompareResult(null);

    try {
      const formData = new FormData();
      formData.append('left', leftFile);
      if (rightSourceMode === 'upload' && rightFile) formData.append('right', rightFile);
      if (rightSourceMode === 'sisense' && sisenseWorkbookData) {
        formData.append('rightWorkbook', JSON.stringify({ workbookData: sisenseWorkbookData }));
      }

      const response = await fetch('/api/excel/inspect', {
        method: 'POST',
        body: formData,
      });

      const json = (await response.json()) as InspectResponse & { error?: string };
      if (!response.ok) throw new Error(json.error || 'Failed to inspect files.');

      const nextLeft = json.workbooks.left;
      const nextRight = json.workbooks.right;
      if (!nextLeft || !nextRight) throw new Error('Could not read both workbooks.');

      const nextLeftSheet = nextLeft.sheets[0];
      const nextRightSheet = nextRight.sheets[0];
      const rawSuggestedMappings = autoMatchColumns(nextLeftSheet?.headers ?? [], nextRightSheet?.headers ?? []);
      const suggestedMappings = filterMappingsWithPreviewDataForUi(
        rawSuggestedMappings,
        nextLeftSheet,
        nextRightSheet
      );
      const excludedMappings = rawSuggestedMappings.filter(
        (mapping) =>
          !suggestedMappings.some(
            (candidate) => candidate.left === mapping.left && candidate.right === mapping.right
          )
      );

      setWorkbooks({ left: nextLeft, right: nextRight });
      setSelectedSheets({
        left: nextLeftSheet?.name ?? '',
        right: nextRightSheet?.name ?? '',
      });
      setCompareMappings(suggestedMappings.length > 0 ? suggestedMappings : [createMapping()]);
      setColumnFilters({});
      setExpandedTables({ left: false, right: false });
      if (excludedMappings.length > 0) {
        const excludedLabels = excludedMappings
          .map((mapping) => mapping.left)
          .filter(Boolean)
          .join(', ');
        setWarning((current) =>
          appendWarningMessage(
            current,
            `Some matched columns were excluded from preview because one side did not return meaningful data for them: ${excludedLabels}.`
          )
        );
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to inspect files.');
    } finally {
      setInspectLoading(false);
    }
  };

  const handleCompare = async () => {
    if (!leftFile || (rightSourceMode === 'upload' && !rightFile) || (rightSourceMode === 'sisense' && !sisenseWorkbookData)) return;

    setCompareLoading(true);
    setError('');

    try {
      const defaultKeyMapping = resolvedCompareMappings[0] ? [resolvedCompareMappings[0]] : [];
      const formData = new FormData();
      formData.append('left', leftFile);
      if (rightSourceMode === 'upload' && rightFile) formData.append('right', rightFile);
      if (rightSourceMode === 'sisense' && sisenseWorkbookData) {
        formData.append('rightWorkbook', JSON.stringify({ workbookData: sisenseWorkbookData }));
      }
      formData.append(
        'config',
        JSON.stringify({
          leftSheet: selectedSheets.left,
          rightSheet: selectedSheets.right,
          compareMappings: resolvedCompareMappings,
          keyMappings: defaultKeyMapping,
          options: {
            trimWhitespace: true,
            ignoreCase: true,
            ignoreEmptyRows: true,
          },
        })
      );

      const response = await fetch('/api/excel/compare', {
        method: 'POST',
        body: formData,
      });

      const json = (await response.json()) as CompareResult & { error?: string };
      if (!response.ok) throw new Error(json.error || 'Failed to compare files.');

      setCompareResult(json);
      setCompareFilter('all');
      setColumnFilters({});
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to compare files.');
    } finally {
      setCompareLoading(false);
    }
  };

  const handleLoadSisenseInventory = async () => {
    if (!isValidHttpUrl(sisenseConfig.baseUrl) || !sisenseConfig.username.trim() || !sisenseConfig.password) {
      setError('Enter a valid platform URL, username, and password.');
      return;
    }

    setInventoryLoading(true);
    setError('');

    try {
      const response = await fetch('/api/excel/sisense/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: sisenseConfig.baseUrl,
          username: sisenseConfig.username.trim(),
          password: sisenseConfig.password,
        }),
      });

      const json = (await response.json()) as { data?: SisenseDashboardOption[]; error?: string };
      if (!response.ok || !json.data) throw new Error(json.error || 'Failed to load platform dashboards.');

      setDashboards(json.data);
      setSisenseConfig((current) => ({
        ...current,
        dashboardId: json.data?.[0]?.dashboardId ?? '',
        widgetId: json.data?.[0]?.widgets?.[0]?.widgetId ?? '',
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load platform dashboards.');
    } finally {
      setInventoryLoading(false);
    }
  };

  const handleLoadSisenseWidget = async () => {
    if (
      !isValidHttpUrl(sisenseConfig.baseUrl) ||
      !sisenseConfig.username.trim() ||
      !sisenseConfig.password ||
      !sisenseConfig.dashboardId ||
      !sisenseConfig.widgetId
    ) {
      setError('Choose the platform dashboard and widget to load.');
      return;
    }

    setWidgetLoading(true);
    setError('');
    setWarning('');

    try {
      const response = await fetch('/api/excel/sisense/widget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: sisenseConfig.baseUrl,
          username: sisenseConfig.username.trim(),
          password: sisenseConfig.password,
          dashboardId: sisenseConfig.dashboardId,
          widgetId: sisenseConfig.widgetId,
        }),
      });

      const json = (await response.json()) as SisenseWidgetResponse & { error?: string };
      if (!response.ok || !json.workbook || !json.workbookData) {
        throw new Error(json.error || 'Failed to load connected widget data.');
      }

      setSisenseWorkbookData(json.workbookData);
      setLoadedSisenseSourceKey(currentSisenseSourceKey);
      setWorkbooks((current) => ({ ...current, right: json.workbook }));
      setSelectedSheets((current) => ({ ...current, right: json.workbook.sheets[0]?.name ?? '' }));
      setCompareResult(null);
      setWarning(json.warning ?? '');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load connected widget.');
    } finally {
      setWidgetLoading(false);
    }
  };

  return (
    <main className="max-w-[1800px] mx-auto px-6 py-8 space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Source Upload</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">File export and connected source</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Upload a vendor export on the left. On the right, either upload another export file or connect to a platform widget directly.
            </p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
            <FileSpreadsheet size={28} />
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <FilePicker
            label="Left Side"
            title="Vendor Export"
            helpText="Upload the Excel or CSV file exported from the left-side source."
            tone="blue"
            file={leftFile}
            onChange={setLeftFile}
          />
          <div className="rounded-[28px] border border-sky-200 bg-sky-50/50 p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Right Side</span>
                <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900">Comparison Source</h3>
              </div>
              <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setRightSourceMode('upload');
                    setWorkbooks((current) => ({ ...current, right: undefined }));
                    setSisenseWorkbookData(null);
                    setLoadedSisenseSourceKey('');
                    setCompareResult(null);
                  }}
                  className={`rounded-xl px-3 py-2 ${rightSourceMode === 'upload' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                >
                  Upload File
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRightSourceMode('sisense');
                    setRightFile(null);
                    setWorkbooks((current) => ({ ...current, right: undefined }));
                    setLoadedSisenseSourceKey('');
                    setCompareResult(null);
                  }}
                  className={`rounded-xl px-3 py-2 ${rightSourceMode === 'sisense' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                >
                  Sisense Live
                </button>
              </div>
            </div>

            {rightSourceMode === 'upload' ? (
              <div className="mt-4">
                <FilePicker
                  label="Comparison File"
                  title="Vendor or Platform Export"
                  helpText="Upload the Excel or CSV file exported from the right-side source."
                  tone="sky"
                  file={rightFile}
                  onChange={setRightFile}
                />
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-medium text-slate-700">
                    Platform URL
                    <input
                      value={sisenseConfig.baseUrl}
                      onChange={(event) => setSisenseConfig((current) => ({ ...current, baseUrl: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Username
                    <input
                      value={sisenseConfig.username}
                      onChange={(event) => setSisenseConfig((current) => ({ ...current, username: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <label className="text-sm font-medium text-slate-700">
                  Password
                  <input
                    type="password"
                    value={sisenseConfig.password}
                    onChange={(event) => setSisenseConfig((current) => ({ ...current, password: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleLoadSisenseInventory}
                    disabled={inventoryLoading}
                    className="group inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-[0_12px_28px_rgba(15,23,42,0.10)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition group-hover:bg-slate-200">
                      <Database size={15} />
                    </span>
                    {inventoryLoading ? 'Loading...' : 'Load Dashboards'}
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadSisenseWidget}
                    disabled={widgetLoading || dashboards.length === 0}
                    className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#0369a1_55%,#0ea5e9_100%)] px-4 py-3 text-sm font-bold text-white shadow-[0_14px_34px_rgba(14,165,233,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(14,165,233,0.34)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/16 text-white ring-1 ring-white/18">
                      <Upload size={15} />
                    </span>
                    {widgetLoading ? 'Loading Widget...' : 'Load Connected Data'}
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-medium text-slate-700">
                    Dashboard
                    <select
                      value={sisenseConfig.dashboardId}
                      onChange={(event) => {
                        const dashboardId = event.target.value;
                        const dashboard = dashboards.find((item) => item.dashboardId === dashboardId);
                        setSisenseConfig((current) => ({
                          ...current,
                          dashboardId,
                          widgetId: dashboard?.widgets[0]?.widgetId ?? '',
                        }));
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Select dashboard</option>
                      {dashboards.map((dashboard, index) => (
                        <option key={`${dashboard.dashboardId}:${index}`} value={dashboard.dashboardId}>
                          {dashboard.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Widget
                    <select
                      value={sisenseConfig.widgetId}
                      onChange={(event) => setSisenseConfig((current) => ({ ...current, widgetId: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Select widget</option>
                      {(selectedDashboard?.widgets ?? []).map((widget, index) => (
                        <option key={`${widget.widgetId}:${index}`} value={widget.widgetId}>
                          {formatWidgetOptionLabel(widget)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleInspect}
            disabled={!canInspect || inspectLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload size={16} />
            {inspectLoading ? 'Loading Preview...' : 'Load Preview Tables'}
          </button>
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}
        {!error && warning ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>{warning}</p>
          </div>
        ) : null}
      </section>

      {leftWorkbook && rightWorkbook ? (
        <section className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-sm">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Visual Preview</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Normalized left and right tables</h2>
              <p className="mt-1 text-sm text-slate-500">
                Only matching headers are shown so both sides can be reviewed in the same structure.
              </p>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <WorkbookCard
              label="Left Source"
              workbook={leftWorkbook}
              selectedSheet={selectedSheets.left}
              compareMappings={compareMappings}
              expanded={expandedTables.left}
              onToggleExpanded={() => setExpandedTables((current) => ({ ...current, left: !current.left }))}
            />
            <WorkbookCard
              label="Right Source"
              workbook={rightWorkbook}
              selectedSheet={selectedSheets.right}
              compareMappings={compareMappings}
              expanded={expandedTables.right}
              onToggleExpanded={() => setExpandedTables((current) => ({ ...current, right: !current.right }))}
            />
          </div>

          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={handleCompare}
              disabled={!canCompare || compareLoading}
              className="inline-flex min-w-[320px] items-center justify-center gap-3 rounded-2xl bg-[linear-gradient(135deg,#4338ca_0%,#6d28d9_55%,#7c3aed_100%)] px-8 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[0_18px_40px_rgba(109,40,217,0.28)] transition hover:scale-[1.01] hover:shadow-[0_22px_48px_rgba(109,40,217,0.34)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArrowDownUp size={17} />
              {compareLoading ? 'Loading Comparison...' : 'Load Comparison'}
            </button>
          </div>
        </section>
      ) : null}

      {compareResult ? (
        <section className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Cross Check Result</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight">
                  {compareResult.summary.isMatch ? 'All data matched' : 'Data differences found'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Cross-checked by matched headers, independent of row order and vendor layout.
                </p>
              </div>
              <div
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.2em] ${
                  compareResult.summary.isMatch ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {compareResult.summary.isMatch ? 'Match' : 'Mismatch'}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <MiniStat label="Matched Rows" value={compareResult.summary.matchedRows} />
              <MiniStat label="Mismatched Rows" value={compareResult.summary.mismatchedRows} />
              <MiniStat label="Left Only" value={compareResult.summary.leftOnlyRows} />
              <MiniStat label="Right Only" value={compareResult.summary.rightOnlyRows} />
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-3">
              <SummaryListCard
                title="Compared Fields"
                tone="emerald"
                items={compareResult.matchedHeaders.map((mapping) => `${mapping.left} ↔ ${mapping.right}`)}
                emptyLabel="No matched fields were compared."
              />
              <SummaryListCard
                title="Ignored Left Fields"
                tone="amber"
                items={ignoredLeftHeaders}
                emptyLabel="No left-side fields were ignored."
              />
              <SummaryListCard
                title="Ignored Right Fields"
                tone="amber"
                items={ignoredRightHeaders}
                emptyLabel="No right-side fields were ignored."
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Line By Line Check</p>
                  <h3 className="mt-1 text-xl font-black tracking-tight">Unified row comparison table</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Each row shows the left and right source values side by side for the same matched headers.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-700">Green = Match</span>
                  <span className="rounded-full bg-rose-100 px-3 py-1.5 text-rose-700">Red = Difference</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-500">
                  Showing {visibleComparisonRows.length} of {compareResult.comparisonRows.length} rows
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setCompareFilter('all')}
                      className={`rounded-xl px-3 py-2 ${compareFilter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                    >
                      All Rows
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareFilter('match')}
                      className={`rounded-xl px-3 py-2 ${compareFilter === 'match' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                    >
                      Match Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareFilter('mismatch')}
                      className={`rounded-xl px-3 py-2 ${compareFilter === 'mismatch' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                    >
                      Mismatches Only
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={exportComparisonCsv}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setColumnFilters({})}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    Clear Filters
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-[75vh] overflow-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-950 text-white">
                  <tr>
                    <th className="sticky left-0 z-20 border border-slate-800 bg-slate-950 px-4 py-3 font-bold">Pair</th>
                    {compareResult.matchedHeaders.map((mapping) => (
                      <th key={`${mapping.left}-${mapping.right}`} className="min-w-[180px] border border-slate-800 px-4 py-3 font-bold">
                        {mapping.left}
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-slate-900">
                    <th className="sticky left-0 z-20 border border-slate-800 bg-slate-900 px-4 py-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Filters</span>
                    </th>
                    {compareResult.matchedHeaders.map((mapping) => (
                      <th key={`filter-${mapping.left}-${mapping.right}`} className="border border-slate-800 px-3 py-2">
                        <input
                          value={columnFilters[mapping.left] ?? ''}
                          onChange={(event) =>
                            setColumnFilters((current) => ({
                              ...current,
                              [mapping.left]: event.target.value,
                            }))
                          }
                          placeholder={`Filter ${mapping.left}`}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleComparisonRows.map((row, index) => (
                    (() => {
                      const cellComparisons = compareResult.matchedHeaders.map((mapping) => {
                        const leftValue = row.leftValues[mapping.left] ?? '';
                        const rightValue = row.rightValues[mapping.right] ?? '';
                        return {
                          mapping,
                          leftValue,
                          rightValue,
                          isCellMatch: isEquivalentCellForUi(leftValue, rightValue),
                        };
                      });
                      const rowHasVisibleDifference = cellComparisons.some((cell) => !cell.isCellMatch);
                      const effectiveStatus =
                        row.status === 'ONLY_IN_LEFT' || row.status === 'ONLY_IN_RIGHT'
                          ? row.status
                          : rowHasVisibleDifference
                            ? 'MISMATCH'
                            : 'MATCH';

                      return (
                        <tr
                          key={`${row.status}-${row.leftRowNumber ?? 'na'}-${row.rightRowNumber ?? 'na'}-${index}`}
                          className={effectiveStatus === 'MATCH' ? 'bg-white' : 'bg-rose-50/30'}
                        >
                          <td className="sticky left-0 z-[5] min-w-[190px] border border-slate-200 bg-white px-4 py-3 align-top">
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-slate-700">
                                <span className="text-slate-400">Left:</span> Row {row.leftRowNumber ?? '-'}
                              </div>
                              <div className="text-xs font-semibold text-slate-700">
                                <span className="text-slate-400">Right:</span> Row {row.rightRowNumber ?? '-'}
                              </div>
                              <div>
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] ${
                                    effectiveStatus === 'MATCH' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                                  }`}
                                >
                                  {effectiveStatus === 'MATCH'
                                    ? 'Match'
                                    : effectiveStatus === 'ONLY_IN_LEFT'
                                      ? 'Left Only'
                                      : effectiveStatus === 'ONLY_IN_RIGHT'
                                        ? 'Right Only'
                                        : 'Mismatch'}
                                </span>
                              </div>
                            </div>
                          </td>
                          {cellComparisons.map(({ mapping, leftValue, rightValue, isCellMatch }) => (
                            <td
                              key={`${index}-${mapping.left}`}
                              className={`border border-slate-200 px-4 py-3 align-top ${isCellMatch ? 'bg-white' : 'bg-rose-50/50'}`}
                            >
                              {isCellMatch ? (
                                <div className="text-sm font-medium text-slate-700">{leftValue || '-'}</div>
                              ) : (
                                <div className="space-y-1.5">
                                  <div className="text-xs font-semibold text-slate-500">Left</div>
                                  <div className="text-sm font-semibold text-slate-800">{leftValue || '-'}</div>
                                  <div className="h-px bg-rose-200" />
                                  <div className="text-xs font-semibold text-slate-500">Right</div>
                                  <div className="text-sm font-semibold text-rose-800">{rightValue || '-'}</div>
                                </div>
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })()
                  ))}
                  {visibleComparisonRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={compareResult.matchedHeaders.length + 1}
                        className="border border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
                      >
                        No rows found for the selected filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function FilePicker({
  label,
  title,
  helpText,
  tone,
  file,
  onChange,
  accept,
}: {
  label: string;
  title: string;
  helpText: string;
  tone: 'blue' | 'sky';
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
}) {
  const toneClasses =
    tone === 'sky'
      ? 'border-sky-200 bg-sky-50/60 hover:border-sky-400 hover:bg-sky-50'
      : 'border-blue-200 bg-blue-50/50 hover:border-blue-400 hover:bg-blue-50';

  return (
    <label className={`block rounded-[28px] border border-dashed p-6 transition ${toneClasses}`}>
      <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-500">{helpText}</p>
      <input
        type="file"
        accept={accept ?? '.xlsx,.csv'}
        className="mt-4 block w-full text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <p className="mt-3 text-xs font-medium text-slate-500">{file ? file.name : 'No file selected yet.'}</p>
    </label>
  );
}

function WorkbookCard({
  label,
  workbook,
  selectedSheet,
  compareMappings,
  expanded,
  onToggleExpanded,
}: {
  label: string;
  workbook: WorkbookSummary;
  selectedSheet: string;
  compareMappings: ColumnMapping[];
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const currentSheet = workbook.sheets.find((sheet) => sheet.name === selectedSheet) ?? workbook.sheets[0];
  const visibleHeaders =
    compareMappings.length > 0
      ? compareMappings.map((mapping) => (label === 'Left Source' ? mapping.left : mapping.right))
      : currentSheet?.headers ?? [];
  const panelHeight = expanded ? 'max-h-[75vh]' : 'max-h-[460px]';
  const accentTone = label === 'Left Source' ? 'text-blue-600' : 'text-sky-600';

  const getCellValueForHeader = (row: string[], header: string) => {
    const headerIndex = currentSheet?.headers.indexOf(header) ?? -1;
    return headerIndex >= 0 ? row[headerIndex] ?? '' : '';
  };

  return (
    <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className={`text-[11px] font-black uppercase tracking-[0.25em] ${accentTone}`}>{label}</p>
            <h2 className="mt-2 text-xl font-black tracking-tight">Preview table</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
              {workbook.sheets.length} sheet{workbook.sheets.length === 1 ? '' : 's'}
            </div>
            <button
              type="button"
              onClick={onToggleExpanded}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {currentSheet ? (
          <div>
            <div className="grid gap-3 md:grid-cols-3">
              <MiniStat label="Rows" value={currentSheet.rowCount} />
              <MiniStat label="Matched Columns" value={visibleHeaders.length} />
              <MiniStat label="Detected Header" value={currentSheet.inferredHeaderRow} />
            </div>
            <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
              <div className={`${panelHeight} overflow-auto`}>
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-950 text-white">
                    <tr>
                      {visibleHeaders.map((header) => (
                        <th key={header} className="px-4 py-3 font-bold">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentSheet.previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-slate-100 bg-white odd:bg-slate-50/60">
                        {visibleHeaders.map((header, visibleIndex) => (
                          <td key={`${rowIndex}-${visibleIndex}`} className="px-4 py-3 text-slate-700">
                            {getCellValueForHeader(row, header) || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function SummaryListCard({
  title,
  items,
  emptyLabel,
  tone,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
  tone: 'emerald' | 'amber';
}) {
  const toneClasses =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50/60 text-emerald-700'
      : 'border-amber-200 bg-amber-50/60 text-amber-700';

  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/50 p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length > 0 ? (
          items.map((item) => (
            <span
              key={`${title}-${item}`}
              className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-bold ${toneClasses}`}
            >
              {item}
            </span>
          ))
        ) : (
          <span className="text-sm text-slate-500">{emptyLabel}</span>
        )}
      </div>
    </div>
  );
}
const normalizeNullLikeTokenForUi = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/[\s./\\_-]+/g, '');
