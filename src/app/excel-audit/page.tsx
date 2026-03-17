'use client';

import { useEffect, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import SisenseUserDashboardInventory from '@/components/SisenseUserDashboardInventory';
import type { ColumnMapping, CompareResult, WorkbookData, WorkbookSummary } from '@/lib/excelAudit';
import { SISENSE_BASE_URLS } from '@/lib/sisenseEnvironments';
import { AlertTriangle, ArrowDownUp, ChevronDown, ChevronUp, Database, FileSpreadsheet, RefreshCcw, Upload } from 'lucide-react';

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
}

interface PythonSmodelMetadataRow {
  source_file?: string | null;
  database?: string | null;
  dataset_name?: string | null;
  schemaName?: string | null;
  dataset_id?: string | null;
  table_id?: string | null;
  table_name?: string | null;
  table_type?: string | null;
  table_expression?: string | null;
  column_id?: string | null;
  column_name?: string | null;
  hidden?: string | null;
  displayName?: string | null;
  description?: string | null;
  dataType?: string | null;
  expression?: string | null;
  dataset_importQuery?: string | null;
  table_importQuery?: string | null;
}

interface SmodelColumnRow {
  key: string;
  datasetId: string;
  datasetName: string;
  schemaName: string;
  tableId: string;
  tableName: string;
  tableType: string;
  tableExpression: string;
  columnId: string;
  columnName: string;
  displayName: string;
  description: string;
  dataType: string;
  hidden: string;
  expression: string;
  datasetImportQuery: string;
  tableImportQuery: string;
  tableQuery: string;
}

interface SmodelCompareRow {
  key: string;
  datasetId: string;
  datasetName: string;
  schemaName: string;
  tableId: string;
  tableName: string;
  tableType: string;
  leftTableType: string;
  rightTableType: string;
  leftTableExpression: string;
  rightTableExpression: string;
  columnId: string;
  columnName: string;
  leftDisplayName: string;
  rightDisplayName: string;
  leftDescription: string;
  rightDescription: string;
  leftDataType: string;
  rightDataType: string;
  leftHidden: string;
  rightHidden: string;
  leftExpression: string;
  rightExpression: string;
  leftDatasetImportQuery: string;
  rightDatasetImportQuery: string;
  leftTableImportQuery: string;
  rightTableImportQuery: string;
  leftTableQuery: string;
  rightTableQuery: string;
  mismatchFields: string[];
  status: 'MATCH' | 'MISMATCH';
}

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const UI_NULL_TOKENS = new Set(['', '-', 'na', 'n/a', 'null', 'none', 'nil', '""', "''", '/', '\\']);

const createMapping = (left = '', right = ''): ColumnMapping => ({ left, right });

const autoMatchColumns = (leftHeaders: string[], rightHeaders: string[]): ColumnMapping[] => {
  const rightLookup = new Map(rightHeaders.map((header) => [normalizeHeader(header), header]));
  return leftHeaders
    .map((leftHeader) => {
      const rightHeader = rightLookup.get(normalizeHeader(leftHeader));
      return rightHeader ? createMapping(leftHeader, rightHeader) : null;
    })
    .filter((mapping): mapping is ColumnMapping => Boolean(mapping));
};

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeCellForUi = (value: string) => {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (UI_NULL_TOKENS.has(text)) return '__null__';
  const withoutQuotes = text.replace(/["']/g, '').trim();
  if (!withoutQuotes) return '__null__';
  const numeric = Number(text.replace(/,/g, ''));
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    if (!Number.isInteger(numeric) && Math.trunc(numeric) >= 20000) {
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
  const normalizedLeft = normalizeCellForUi(left);
  const normalizedRight = normalizeCellForUi(right);
  if (normalizedLeft === normalizedRight) return true;

  const leftNameMask = nameMaskSignatureForUi(normalizedLeft);
  const rightNameMask = nameMaskSignatureForUi(normalizedRight);
  return Boolean(leftNameMask && rightNameMask && leftNameMask === rightNameMask);
};

const EXCEL_AUDIT_SISENSE_STORAGE_KEY = 'excel-audit-sisense-config';

const toSmodelText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const buildSmodelCompareRows = (leftRows: SmodelColumnRow[], rightRows: SmodelColumnRow[]): SmodelCompareRow[] => {
  const leftMap = new Map(leftRows.map((row) => [row.key, row]));
  const rightMap = new Map(rightRows.map((row) => [row.key, row]));
  const allKeys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort();

  return allKeys.map((key) => {
    const left = leftMap.get(key);
    const right = rightMap.get(key);
    const leftTableType = left?.tableType ?? '';
    const rightTableType = right?.tableType ?? '';
    const leftTableExpression = left?.tableExpression ?? '';
    const rightTableExpression = right?.tableExpression ?? '';
    const leftDisplayName = left?.displayName ?? '';
    const rightDisplayName = right?.displayName ?? '';
    const leftDescription = left?.description ?? '';
    const rightDescription = right?.description ?? '';
    const leftDataType = left?.dataType ?? '';
    const rightDataType = right?.dataType ?? '';
    const leftHidden = left?.hidden ?? '';
    const rightHidden = right?.hidden ?? '';
    const leftExpression = left?.expression ?? '';
    const rightExpression = right?.expression ?? '';
    const leftDatasetImportQuery = left?.datasetImportQuery ?? '';
    const rightDatasetImportQuery = right?.datasetImportQuery ?? '';
    const leftTableImportQuery = left?.tableImportQuery ?? '';
    const rightTableImportQuery = right?.tableImportQuery ?? '';
    const leftTableQuery = left?.tableQuery ?? '';
    const rightTableQuery = right?.tableQuery ?? '';
    const mismatchFields: string[] = [];
    if (leftTableType !== rightTableType) mismatchFields.push('table_type');
    if (leftTableExpression !== rightTableExpression) mismatchFields.push('table_expression');
    if (leftDisplayName !== rightDisplayName) mismatchFields.push('displayName');
    if (leftDescription !== rightDescription) mismatchFields.push('description');
    if (leftDataType !== rightDataType) mismatchFields.push('dataType');
    if (leftHidden !== rightHidden) mismatchFields.push('hidden');
    if (leftExpression !== rightExpression) mismatchFields.push('expression');
    if (leftDatasetImportQuery !== rightDatasetImportQuery) mismatchFields.push('dataset_importQuery');
    if (leftTableImportQuery !== rightTableImportQuery) mismatchFields.push('table_importQuery');
    if (leftTableQuery !== rightTableQuery) mismatchFields.push('table_query');
    const status: 'MATCH' | 'MISMATCH' = mismatchFields.length === 0 ? 'MATCH' : 'MISMATCH';

    return {
      key,
      datasetId: left?.datasetId || right?.datasetId || '',
      datasetName: left?.datasetName || right?.datasetName || '',
      schemaName: left?.schemaName || right?.schemaName || '',
      tableId: left?.tableId || right?.tableId || '',
      tableName: left?.tableName || right?.tableName || '',
      tableType: leftTableType || rightTableType,
      leftTableType,
      rightTableType,
      leftTableExpression,
      rightTableExpression,
      columnId: left?.columnId || right?.columnId || '',
      columnName: left?.columnName || right?.columnName || '',
      leftDisplayName,
      rightDisplayName,
      leftDescription,
      rightDescription,
      leftDataType,
      rightDataType,
      leftHidden,
      rightHidden,
      leftExpression,
      rightExpression,
      leftDatasetImportQuery,
      rightDatasetImportQuery,
      leftTableImportQuery,
      rightTableImportQuery,
      leftTableQuery,
      rightTableQuery,
      mismatchFields,
      status,
    };
  });
};

const buildSmodelRowsFromPythonMetadata = (
  metadataRows: PythonSmodelMetadataRow[],
  leftLabel: string,
  rightLabel: string
): SmodelCompareRow[] => {
  const normalize = (value: unknown) => toSmodelText(value);
  const toComparable = (row: PythonSmodelMetadataRow): SmodelColumnRow => {
    const database = normalize(row.database);
    const datasetId = normalize(row.dataset_id);
    const schemaName = normalize(row.schemaName);
    const tableId = normalize(row.table_id);
    const columnId = normalize(row.column_id);
    const tableExpression = normalize(row.table_expression);
    const tableImportQuery = normalize(row.table_importQuery);
    return {
      key: `${database}|${datasetId}|${schemaName}|${tableId}|${columnId}`,
      datasetId,
      datasetName: normalize(row.dataset_name),
      schemaName,
      tableId,
      tableName: normalize(row.table_name),
      tableType: normalize(row.table_type),
      tableExpression,
      columnId,
      columnName: normalize(row.column_name),
      displayName: normalize(row.displayName),
      description: normalize(row.description),
      dataType: normalize(row.dataType),
      hidden: normalize(row.hidden),
      expression: normalize(row.expression),
      datasetImportQuery: normalize(row.dataset_importQuery),
      tableImportQuery,
      tableQuery: tableExpression || tableImportQuery,
    };
  };

  const leftRows = metadataRows
    .filter((row) => normalize(row.source_file) === leftLabel)
    .map(toComparable);
  const rightRows = metadataRows
    .filter((row) => normalize(row.source_file) === rightLabel)
    .map(toComparable);
  return buildSmodelCompareRows(leftRows, rightRows);
};

export default function ExcelAuditPage() {
  const [activeTab, setActiveTab] = useState<'excel' | 'smodel' | 'widget-inventory' | 'function-inventory'>('excel');
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
  const [smodelLeftFile, setSmodelLeftFile] = useState<File | null>(null);
  const [smodelRightFile, setSmodelRightFile] = useState<File | null>(null);
  const [smodelCompareLoading, setSmodelCompareLoading] = useState(false);
  const [smodelError, setSmodelError] = useState('');
  const [smodelSuccess, setSmodelSuccess] = useState('');
  const [smodelRows, setSmodelRows] = useState<SmodelCompareRow[]>([]);
  const [smodelFilter, setSmodelFilter] = useState<'mismatch' | 'match' | 'all'>('all');
  const [expandedTables, setExpandedTables] = useState({
    left: false,
    right: false,
  });
  const [masterInspectorConfig] = useState({
    baseUrl: SISENSE_BASE_URLS.sisense_25_4_sp2,
    token: '',
  });

  const leftWorkbook = workbooks.left;
  const rightWorkbook = workbooks.right;

  const leftSheet = leftWorkbook?.sheets.find((sheet) => sheet.name === selectedSheets.left) ?? leftWorkbook?.sheets[0];
  const rightSheet = rightWorkbook?.sheets.find((sheet) => sheet.name === selectedSheets.right) ?? rightWorkbook?.sheets[0];

  const canInspect = Boolean(leftFile && (rightSourceMode === 'upload' ? rightFile : sisenseWorkbookData));
  const canCompare = Boolean(leftFile && (rightSourceMode === 'upload' ? rightFile : sisenseWorkbookData) && compareMappings.length > 0);
  const leftHeaders = leftSheet?.headers ?? [];
  const rightHeaders = rightSheet?.headers ?? [];
  const selectedDashboard = dashboards.find((dashboard) => dashboard.dashboardId === sisenseConfig.dashboardId);
  const visibleComparisonRows =
    compareResult?.comparisonRows.filter((row) =>
      compareFilter === 'all' ? true : compareFilter === 'match' ? row.status === 'MATCH' : row.status !== 'MATCH'
    ) ?? [];
  const canRunSmodelCompare = Boolean(smodelLeftFile && smodelRightFile);
  const visibleSmodelRows = smodelRows.filter((row) =>
    smodelFilter === 'all' ? true : smodelFilter === 'match' ? row.status === 'MATCH' : row.status !== 'MATCH'
  );
  const smodelMismatchCount = smodelRows.filter((row) => row.status === 'MISMATCH').length;

  const exportComparisonCsv = () => {
    if (!compareResult) return;

    const headers = [
      'Status',
      'Left Row',
      'Right Row',
      ...compareResult.matchedHeaders.flatMap((mapping) => [
        `Left: ${mapping.left}`,
        `Right: ${mapping.right}`,
      ]),
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
    setCompareResult(null);

    try {
      const formData = new FormData();
      formData.append('left', leftFile);
      if (rightSourceMode === 'upload' && rightFile) {
        formData.append('right', rightFile);
      }
      if (rightSourceMode === 'sisense' && sisenseWorkbookData) {
        formData.append('rightWorkbook', JSON.stringify({ workbookData: sisenseWorkbookData }));
      }

      const response = await fetch('/api/excel/inspect', {
        method: 'POST',
        body: formData,
      });

      const json = (await response.json()) as InspectResponse & { error?: string };
      if (!response.ok) {
        throw new Error(json.error || 'Failed to inspect files.');
      }

      const nextLeft = json.workbooks.left;
      const nextRight = json.workbooks.right;
      if (!nextLeft || !nextRight) {
        throw new Error('Could not read both workbooks.');
      }

      const nextLeftSheet = nextLeft.sheets[0];
      const nextRightSheet = nextRight.sheets[0];
      const suggestedMappings = autoMatchColumns(nextLeftSheet?.headers ?? [], nextRightSheet?.headers ?? []);

      setWorkbooks({ left: nextLeft, right: nextRight });
      setSelectedSheets({
        left: nextLeftSheet?.name ?? '',
        right: nextRightSheet?.name ?? '',
      });
      setCompareMappings(suggestedMappings.length > 0 ? suggestedMappings : [createMapping()]);
      setExpandedTables({ left: false, right: false });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to inspect files.';
      setError(message);
    } finally {
      setInspectLoading(false);
    }
  };

  const refreshAutoMappings = () => {
    const suggestedMappings = autoMatchColumns(leftHeaders, rightHeaders);
    setCompareMappings(suggestedMappings.length > 0 ? suggestedMappings : [createMapping()]);
  };

  const handleCompare = async () => {
    if (!leftFile || (rightSourceMode === 'upload' && !rightFile) || (rightSourceMode === 'sisense' && !sisenseWorkbookData)) return;

    setCompareLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('left', leftFile);
      if (rightSourceMode === 'upload' && rightFile) {
        formData.append('right', rightFile);
      }
      if (rightSourceMode === 'sisense' && sisenseWorkbookData) {
        formData.append('rightWorkbook', JSON.stringify({ workbookData: sisenseWorkbookData }));
      }
      formData.append(
        'config',
        JSON.stringify({
          leftSheet: selectedSheets.left,
          rightSheet: selectedSheets.right,
          compareMappings: compareMappings.filter((mapping) => mapping.left && mapping.right),
          keyMappings: [],
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
      if (!response.ok) {
        throw new Error(json.error || 'Failed to compare files.');
      }

      setCompareResult(json);
      setCompareFilter('all');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to compare files.';
      setError(message);
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
      if (!response.ok || !json.data) {
        throw new Error(json.error || 'Failed to load platform dashboards.');
      }

      setDashboards(json.data);
      setSisenseConfig((current) => ({
        ...current,
        dashboardId: json.data?.[0]?.dashboardId ?? '',
        widgetId: json.data?.[0]?.widgets?.[0]?.widgetId ?? '',
      }));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to load platform dashboards.';
      setError(message);
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

      const json = (await response.json()) as (SisenseWidgetResponse & { error?: string });
      if (!response.ok || !json.workbook || !json.workbookData) {
        throw new Error(json.error || 'Failed to load connected widget data.');
      }

      setSisenseWorkbookData(json.workbookData);
      setWorkbooks((current) => ({ ...current, right: json.workbook }));
      setSelectedSheets((current) => ({
        ...current,
        right: json.workbook.sheets[0]?.name ?? '',
      }));
      setCompareResult(null);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to load connected widget.';
      setError(message);
    } finally {
      setWidgetLoading(false);
    }
  };

  const parseFilenameFromContentDisposition = (headerValue: string | null) => {
    if (!headerValue) return '';
    const filenameStarMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (filenameStarMatch?.[1]) {
      try {
        return decodeURIComponent(filenameStarMatch[1]);
      } catch {
        return filenameStarMatch[1];
      }
    }

    const filenameMatch = headerValue.match(/filename=\"?([^\";]+)\"?/i);
    return filenameMatch?.[1] ?? '';
  };

  const handleSmodelCompare = async () => {
    if (!smodelLeftFile || !smodelRightFile) return;

    setSmodelCompareLoading(true);
    setSmodelError('');
    setSmodelSuccess('');

    try {
      const dataForm = new FormData();
      dataForm.append('left', smodelLeftFile);
      dataForm.append('right', smodelRightFile);
      const dataResponse = await fetch('/api/excel/sisense/smodel-compare-data', {
        method: 'POST',
        body: dataForm,
      });
      const dataJson = (await dataResponse.json()) as {
        error?: string;
        model_a_label?: string;
        model_b_label?: string;
        sheets?: {
          METADATA?: PythonSmodelMetadataRow[];
        };
      };
      if (!dataResponse.ok) {
        throw new Error(dataJson.error || 'Failed to load Python comparison sheet data.');
      }

      const metadataRows = Array.isArray(dataJson.sheets?.METADATA) ? dataJson.sheets.METADATA : [];
      const leftLabel = dataJson.model_a_label || smodelLeftFile.name;
      const rightLabel = dataJson.model_b_label || smodelRightFile.name;
      setSmodelRows(buildSmodelRowsFromPythonMetadata(metadataRows, leftLabel, rightLabel));
      setSmodelFilter('all');

      const formData = new FormData();
      formData.append('left', smodelLeftFile);
      formData.append('right', smodelRightFile);

      const response = await fetch('/api/excel/sisense/smodel-compare', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = 'Failed to compare .smodel files.';
        try {
          const json = (await response.json()) as { error?: string };
          if (json.error) errorMessage = json.error;
        } catch {
          // Keep default message when response body is not JSON.
        }
        throw new Error(errorMessage);
      }

      const disposition = response.headers.get('Content-Disposition');
      const suggestedFilename = parseFilenameFromContentDisposition(disposition) || `smodel_comparison_${Date.now()}.xlsx`;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = suggestedFilename;
      link.click();
      URL.revokeObjectURL(url);
      setSmodelSuccess(`Workbook generated: ${suggestedFilename}`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to compare .smodel files.';
      setSmodelError(message);
    } finally {
      setSmodelCompareLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] text-slate-900">
      <AppHeader
        title="Audit"
        subtitle="Compare a file export with another vendor or connected platform source, even when layouts do not match."
        backHref="/"
      />

      <main className="max-w-[1800px] mx-auto px-6 py-8 space-y-6">
        <section className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
          <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('excel')}
              className={`rounded-xl px-4 py-2 ${activeTab === 'excel' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
            >
              File Compare
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('smodel')}
              className={`rounded-xl px-4 py-2 ${activeTab === 'smodel' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
            >
              Smodel Compare
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('widget-inventory')}
              className={`rounded-xl px-4 py-2 ${activeTab === 'widget-inventory' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
            >
              Widget Inventory
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('function-inventory')}
              className={`rounded-xl px-4 py-2 ${activeTab === 'function-inventory' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
            >
              Function Lookup
            </button>
          </div>
        </section>

        {activeTab === 'excel' ? (
          <>
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
                      setCompareResult(null);
                    }}
                    className={`rounded-xl px-3 py-2 ${rightSourceMode === 'upload' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                  >
                    File
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRightSourceMode('sisense');
                      setRightFile(null);
                      setWorkbooks((current) => ({ ...current, right: undefined }));
                      setCompareResult(null);
                    }}
                    className={`rounded-xl px-3 py-2 ${rightSourceMode === 'sisense' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                  >
                    Widget
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
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleLoadSisenseInventory}
                      disabled={inventoryLoading}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-60"
                    >
                      <Database size={15} />
                      {inventoryLoading ? 'Loading...' : 'Load Dashboards'}
                    </button>
                    <button
                      type="button"
                      onClick={handleLoadSisenseWidget}
                      disabled={widgetLoading || dashboards.length === 0}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-200 disabled:opacity-60"
                    >
                      <Upload size={15} />
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
                        {dashboards.map((dashboard) => (
                          <option key={dashboard.dashboardId} value={dashboard.dashboardId}>
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
                        {(selectedDashboard?.widgets ?? []).map((widget) => (
                          <option key={widget.widgetId} value={widget.widgetId}>
                            {widget.title}
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
            </section>

            {leftWorkbook && rightWorkbook ? (
              <section className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-sm">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Visual Preview</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight">Normalized left and right tables</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Only matching headers are shown so both sides can be reviewed in the same structure.
                </p>
              </div>
              <button
                type="button"
                onClick={refreshAutoMappings}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600 transition hover:border-slate-400 hover:bg-slate-50"
              >
                <RefreshCcw size={14} />
                Refresh Matched Headers
              </button>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <WorkbookCard
                label="Left Source"
                workbook={leftWorkbook}
                selectedSheet={selectedSheets.left}
                compareMappings={compareMappings}
                expanded={expandedTables.left}
                onToggleExpanded={() =>
                  setExpandedTables((current) => ({ ...current, left: !current.left }))
                }
              />
              <WorkbookCard
                label="Right Source"
                workbook={rightWorkbook}
                selectedSheet={selectedSheets.right}
                compareMappings={compareMappings}
                expanded={expandedTables.right}
                onToggleExpanded={() =>
                  setExpandedTables((current) => ({ ...current, right: !current.right }))
                }
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
                        className={`rounded-xl px-3 py-2 ${
                          compareFilter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600'
                        }`}
                      >
                        All Rows
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompareFilter('match')}
                        className={`rounded-xl px-3 py-2 ${
                          compareFilter === 'match' ? 'bg-slate-900 text-white' : 'text-slate-600'
                        }`}
                      >
                        Match Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompareFilter('mismatch')}
                        className={`rounded-xl px-3 py-2 ${
                          compareFilter === 'mismatch' ? 'bg-slate-900 text-white' : 'text-slate-600'
                        }`}
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
                  </thead>
                  <tbody>
                    {visibleComparisonRows.map((row, index) => (
                      <tr
                        key={`${row.status}-${row.leftRowNumber ?? 'na'}-${row.rightRowNumber ?? 'na'}-${index}`}
                        className={row.status === 'MATCH' ? 'bg-white' : 'bg-rose-50/30'}
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
                                  row.status === 'MATCH'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                {row.status === 'MATCH'
                                  ? 'Match'
                                  : row.status === 'ONLY_IN_LEFT'
                                    ? 'Left Only'
                                    : row.status === 'ONLY_IN_RIGHT'
                                      ? 'Right Only'
                                      : 'Mismatch'}
                              </span>
                            </div>
                          </div>
                        </td>
                        {compareResult.matchedHeaders.map((mapping) => {
                          const leftValue = row.leftValues[mapping.left] ?? '';
                          const rightValue = row.rightValues[mapping.right] ?? '';
                          const isCellMatch = isEquivalentCellForUi(leftValue, rightValue);

                          return (
                            <td
                              key={`${index}-${mapping.left}`}
                              className={`border border-slate-200 px-4 py-3 align-top ${
                                isCellMatch ? 'bg-white' : 'bg-rose-50/50'
                              }`}
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
                          );
                        })}
                      </tr>
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
          </>
        ) : activeTab === 'smodel' ? (
          <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Sisense Model Audit</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight">Smodel comparison export</h2>
                <p className="mt-2 max-w-3xl text-sm text-slate-500">
                  Upload two Sisense `.smodel` files and download a workbook with metadata, joins, table queries, hidden fields, and datatype differences.
                </p>
              </div>
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                <Database size={28} />
              </div>
            </div>

            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <FilePicker
                label="Model A"
                title="Baseline Smodel"
                helpText="Upload the first Sisense model export file."
                tone="blue"
                file={smodelLeftFile}
                onChange={setSmodelLeftFile}
                accept=".smodel,.json"
              />
              <FilePicker
                label="Model B"
                title="Target Smodel"
                helpText="Upload the second Sisense model export file."
                tone="sky"
                file={smodelRightFile}
                onChange={setSmodelRightFile}
                accept=".smodel,.json"
              />
            </div>

            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={handleSmodelCompare}
                disabled={!canRunSmodelCompare || smodelCompareLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowDownUp size={16} />
                {smodelCompareLoading ? 'Building Workbook...' : 'Compare and Download Workbook'}
              </button>
            </div>

            {smodelError ? (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <p>{smodelError}</p>
              </div>
            ) : null}

            {smodelSuccess ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {smodelSuccess}
              </div>
            ) : null}

            {smodelRows.length ? (
              <div className="mt-6 overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Smodel Side-By-Side</p>
                      <h3 className="mt-1 text-xl font-black tracking-tight">Model A vs Model B table comparison</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Compared by Dataset + Schema + Table ID + Column ID. Mirrors metadata extraction logic from the Python script.
                      </p>
                    </div>
                    <div className="grid gap-2 text-xs font-bold">
                      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">Rows: {smodelRows.length}</span>
                      <span className="rounded-full bg-rose-100 px-3 py-1.5 text-rose-700">Mismatches: {smodelMismatchCount}</span>
                    </div>
                  </div>
                  <div className="mt-4 inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setSmodelFilter('all')}
                      className={`rounded-xl px-3 py-2 ${smodelFilter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                    >
                      All Rows
                    </button>
                    <button
                      type="button"
                      onClick={() => setSmodelFilter('match')}
                      className={`rounded-xl px-3 py-2 ${smodelFilter === 'match' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                    >
                      Match Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setSmodelFilter('mismatch')}
                      className={`rounded-xl px-3 py-2 ${smodelFilter === 'mismatch' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                    >
                      Mismatches Only
                    </button>
                  </div>
                </div>

                <div className="max-h-[70vh] overflow-auto">
                  <table className="min-w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-950 text-white">
                      <tr>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Status</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Mismatch Fields</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Dataset ID</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Dataset</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Schema</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Table ID</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Table</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Table Type</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Table Type</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Table Expression</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Table Expression</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Column ID</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Column</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Display Name</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Display Name</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Description</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Description</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Datatype</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Datatype</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Hidden</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Hidden</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Expression</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Expression</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Dataset Import Query</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Dataset Import Query</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Table Import Query</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Table Import Query</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model A Table Query</th>
                        <th className="border border-slate-800 px-3 py-2 font-bold">Model B Table Query</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSmodelRows.map((row) => (
                        <tr key={row.key} className={row.status === 'MATCH' ? 'bg-white' : 'bg-rose-50/40'}>
                          <td className="border border-slate-200 px-3 py-2">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] ${
                                row.status === 'MATCH' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-700">
                            {row.mismatchFields.length ? row.mismatchFields.join(', ') : '-'}
                          </td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.datasetId || '-'}</td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.datasetName || '-'}</td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.schemaName || '-'}</td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.tableId || '-'}</td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.tableName || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftTableType === row.rightTableType ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftTableType || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftTableType === row.rightTableType ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightTableType || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftTableExpression === row.rightTableExpression ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftTableExpression || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftTableExpression === row.rightTableExpression ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightTableExpression || '-'}</td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.columnId || '-'}</td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.columnName || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftDisplayName === row.rightDisplayName ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftDisplayName || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftDisplayName === row.rightDisplayName ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightDisplayName || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftDescription === row.rightDescription ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftDescription || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftDescription === row.rightDescription ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightDescription || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftDataType === row.rightDataType ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftDataType || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftDataType === row.rightDataType ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightDataType || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftHidden === row.rightHidden ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftHidden || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftHidden === row.rightHidden ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightHidden || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftExpression === row.rightExpression ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftExpression || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftExpression === row.rightExpression ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightExpression || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftDatasetImportQuery === row.rightDatasetImportQuery ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftDatasetImportQuery || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftDatasetImportQuery === row.rightDatasetImportQuery ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightDatasetImportQuery || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftTableImportQuery === row.rightTableImportQuery ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftTableImportQuery || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftTableImportQuery === row.rightTableImportQuery ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightTableImportQuery || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftTableQuery === row.rightTableQuery ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.leftTableQuery || '-'}</td>
                          <td className={`border border-slate-200 px-3 py-2 ${row.leftTableQuery === row.rightTableQuery ? 'text-slate-700' : 'text-rose-700 font-semibold'}`}>{row.rightTableQuery || '-'}</td>
                        </tr>
                      ))}
                      {visibleSmodelRows.length === 0 ? (
                        <tr>
                          <td colSpan={28} className="border border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                            No rows found for the selected filter.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>
        ) : activeTab === 'widget-inventory' ? (
          <SisenseUserDashboardInventory
            initialBaseUrl={masterInspectorConfig.baseUrl}
            initialToken={masterInspectorConfig.token}
            mode="widget"
          />
        ) : (
          <SisenseUserDashboardInventory
            initialBaseUrl={masterInspectorConfig.baseUrl}
            initialToken={masterInspectorConfig.token}
            mode="function"
          />
        )}
      </main>
    </div>
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
  const visibleHeaders = compareMappings.length > 0 ? compareMappings.map((mapping) => (label === 'Left Source' ? mapping.left : mapping.right)) : currentSheet?.headers ?? [];
  const visibleIndexes = visibleHeaders.map((header) => currentSheet?.headers.indexOf(header) ?? -1);
  const panelHeight = expanded ? 'max-h-[75vh]' : 'max-h-[460px]';
  const accentTone = label === 'Left Source' ? 'text-blue-600' : 'text-sky-600';

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
                        {visibleIndexes.map((cellIndex, visibleIndex) => (
                          <td key={`${rowIndex}-${visibleIndex}`} className="px-4 py-3 text-slate-700">
                            {(cellIndex >= 0 ? row[cellIndex] : '') || '-'}
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
