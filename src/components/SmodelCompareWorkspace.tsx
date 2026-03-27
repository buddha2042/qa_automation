'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowDownUp, Database } from 'lucide-react';

interface PythonSmodelMetadataRow {
  source_file?: string | null;
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

interface PythonSmodelColumnSummaryRow {
  dataset_id?: string | null;
  schemaName?: string | null;
  table_id?: string | null;
  table_name?: string | null;
  [key: string]: unknown;
}

interface PythonSmodelJoinSummaryRow {
  dataset_id?: string | null;
  schemaName?: string | null;
  table_id?: string | null;
  table_name?: string | null;
  [key: string]: unknown;
}

interface PythonSmodelJoinMetadataRow {
  source_file?: string | null;
  relation_oid?: string | null;
  left_table_id?: string | null;
  left_table?: string | null;
  left_column?: string | null;
  right_table_id?: string | null;
  right_table?: string | null;
  right_column?: string | null;
  [key: string]: unknown;
}

interface PythonSmodelQueryDiffRow {
  dataset_id?: string | null;
  schemaName?: string | null;
  table_id?: string | null;
  table_name?: string | null;
  is_different?: boolean | string | null;
  [key: string]: unknown;
}

interface PythonSmodelColumnAttrDiffRow {
  dataset_id?: string | null;
  schemaName?: string | null;
  table_id?: string | null;
  table_name?: string | null;
  [key: string]: unknown;
}

interface PythonSmodelCustomFieldRow {
  dataset_id?: string | null;
  schemaName?: string | null;
  table_id?: string | null;
  table_name?: string | null;
  [key: string]: unknown;
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
  leftTableType: string;
  rightTableType: string;
  leftTableExpression: string;
  rightTableExpression: string;
  leftDataType: string;
  rightDataType: string;
  leftHidden: string;
  rightHidden: string;
  leftDatasetImportQuery: string;
  rightDatasetImportQuery: string;
  leftTableQuery: string;
  rightTableQuery: string;
  columnCountModelA: number;
  columnCountModelB: number;
  columnCountDiff: number;
  fieldCountWithoutCustomModelA: number;
  fieldCountWithoutCustomModelB: number;
  customFieldCountModelA: number;
  customFieldCountModelB: number;
  availableFieldCountModelA: number;
  availableFieldCountModelB: number;
  droppedFieldCountModelA: number;
  droppedFieldCountModelB: number;
  joinCountModelA: number;
  joinCountModelB: number;
  joinCountDiff: number;
  joinFieldsModelA: string;
  joinFieldsModelB: string;
  joinFieldsDisplay: string;
  hiddenTotalModelA: number;
  hiddenTotalModelB: number;
  hiddenTotalDiff: number;
  tableQueryDiff: boolean;
  hiddenDiffCount: number;
  datatypeDiffCount: number;
  mismatchFields: string[];
  status: 'MATCH' | 'MISMATCH';
}

type SmodelFilter = 'mismatch' | 'match' | 'all' | 'query';

interface PythonSmodelSheets {
  METADATA?: PythonSmodelMetadataRow[];
  JOINS_METADATA?: PythonSmodelJoinMetadataRow[];
  COLUMN_SUMMARY?: PythonSmodelColumnSummaryRow[];
  JOIN_SUMMARY?: PythonSmodelJoinSummaryRow[];
  TABLE_QUERIES?: PythonSmodelQueryDiffRow[];
  CUSTOM_TABLES?: PythonSmodelQueryDiffRow[];
  CUSTOM_FIELDS?: PythonSmodelCustomFieldRow[];
  HIDDEN_COLUMNS?: PythonSmodelColumnAttrDiffRow[];
  DATATYPES?: PythonSmodelColumnAttrDiffRow[];
}

interface SmodelTableSummary {
  columnCountModelA: number;
  columnCountModelB: number;
  columnCountDiff: number;
  fieldCountWithoutCustomModelA: number;
  fieldCountWithoutCustomModelB: number;
  customFieldCountModelA: number;
  customFieldCountModelB: number;
  availableFieldCountModelA: number;
  availableFieldCountModelB: number;
  droppedFieldCountModelA: number;
  droppedFieldCountModelB: number;
  joinCountModelA: number;
  joinCountModelB: number;
  joinCountDiff: number;
  joinFieldsModelA: string;
  joinFieldsModelB: string;
  hiddenTotalModelA: number;
  hiddenTotalModelB: number;
  hiddenTotalDiff: number;
  hiddenDiffSummaryModelA: string;
  hiddenDiffSummaryModelB: string;
  datatypeDiffSummaryModelA: string;
  datatypeDiffSummaryModelB: string;
  leftTableQuery: string;
  rightTableQuery: string;
  tableQueryDiff: boolean;
  hiddenDiffCount: number;
  datatypeDiffCount: number;
}

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

const normalizeSmodelKeyPart = (value: unknown): string =>
  toSmodelText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const escapeXml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const stripFileExtension = (value: string) => value.replace(/\.[^/.]+$/, '');

const toDownloadSafeName = (value: string) =>
  stripFileExtension(value)
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'model';

const buildSmodelTableLookupKey = (parts: {
  tableName?: unknown;
  tableId?: unknown;
}) =>
  normalizeSmodelKeyPart(parts.tableName || parts.tableId);

const getNumberField = (row: Record<string, unknown>, fieldName: string) => {
  const value = row[fieldName];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(toSmodelText(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const getBooleanField = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  const text = normalizeSmodelKeyPart(value);
  return text === 'true' || text === '1' || text === 'yes';
};

const formatSummaryList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => toSmodelText(item)).filter(Boolean).join(' | ');
  }
  return toSmodelText(value);
};

const getFirstMatchingFieldText = (row: Record<string, unknown>, prefixes: string[]) => {
  const matchingField = Object.keys(row).find((field) => prefixes.some((prefix) => field.startsWith(prefix)));
  return matchingField ? toSmodelText(row[matchingField]) : '';
};

const formatMismatchFieldLabel = (value: string) => {
  switch (value) {
    case 'table_type':
      return 'Table Type';
    case 'column_count':
      return 'Total Field Count';
    case 'join_count':
      return 'Join Count';
    case 'table_query_diff':
      return 'Query Difference';
    case 'hidden_diff_total':
      return 'Hidden Columns Difference';
    case 'hidden_total_diff':
      return 'Hidden Columns Difference';
    case 'datatype_diff_total':
      return 'Datatype Differences';
    default:
      return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
};

const splitJoinFieldDetails = (value: string) =>
  value
    .split(' | ')
    .map((item) => item.trim())
    .filter(Boolean);

const summarizeDatatypeDiffFields = (leftValue: string, rightValue: string) => {
  const labels = new Set<string>();
  const collect = (value: string) => {
    value
      .split(' | ')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        const [fieldName] = item.split(':');
        if (fieldName?.trim()) labels.add(fieldName.trim());
      });
  };

  collect(leftValue);
  collect(rightValue);
  return Array.from(labels).sort().join(', ');
};

const summarizeJoinKeys = (value: string) => {
  const labels = new Set<string>();
  value
    .split(' | ')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const [fieldName] = item.split('->');
      if (fieldName?.trim()) labels.add(fieldName.trim());
    });

  return Array.from(labels).sort();
};

const buildDefaultTableQuery = (schemaName: string, tableName: string) => {
  const schema = schemaName.trim();
  const table = tableName.trim();
  if (!table) return '';
  return schema ? `SELECT * FROM ${schema}.${table}` : `SELECT * FROM ${table}`;
};

const buildSmodelTableSummaries = (
  sheets: PythonSmodelSheets,
  modelAName: string,
  modelBName: string,
  leftSourceLabel: string,
  rightSourceLabel: string
) => {
  const summaries = new Map<string, SmodelTableSummary>();
  const getSummary = (key: string) => {
    const existing = summaries.get(key);
    if (existing) return existing;
    const created: SmodelTableSummary = {
      columnCountModelA: 0,
      columnCountModelB: 0,
      columnCountDiff: 0,
      fieldCountWithoutCustomModelA: 0,
      fieldCountWithoutCustomModelB: 0,
      customFieldCountModelA: 0,
      customFieldCountModelB: 0,
      availableFieldCountModelA: 0,
      availableFieldCountModelB: 0,
      droppedFieldCountModelA: 0,
      droppedFieldCountModelB: 0,
      joinCountModelA: 0,
      joinCountModelB: 0,
      joinCountDiff: 0,
      joinFieldsModelA: '',
      joinFieldsModelB: '',
      hiddenTotalModelA: 0,
      hiddenTotalModelB: 0,
      hiddenTotalDiff: 0,
      hiddenDiffSummaryModelA: '',
      hiddenDiffSummaryModelB: '',
      datatypeDiffSummaryModelA: '',
      datatypeDiffSummaryModelB: '',
      leftTableQuery: '',
      rightTableQuery: '',
      tableQueryDiff: false,
      hiddenDiffCount: 0,
      datatypeDiffCount: 0,
    };
    summaries.set(key, created);
    return created;
  };

  for (const row of sheets.COLUMN_SUMMARY ?? []) {
    const key = buildSmodelTableLookupKey({ tableName: row.table_name, tableId: row.table_id });
    const summary = getSummary(key);
    summary.columnCountModelA = getNumberField(row as Record<string, unknown>, `column_count_in_${modelAName}`);
    summary.columnCountModelB = getNumberField(row as Record<string, unknown>, `column_count_in_${modelBName}`);
    summary.columnCountDiff = getNumberField(row as Record<string, unknown>, `column_count_diff_${modelBName}_minus_${modelAName}`);
    summary.fieldCountWithoutCustomModelA = getNumberField(row as Record<string, unknown>, `field_count_without_custom_in_${modelAName}`);
    summary.fieldCountWithoutCustomModelB = getNumberField(row as Record<string, unknown>, `field_count_without_custom_in_${modelBName}`);
    summary.customFieldCountModelA = getNumberField(row as Record<string, unknown>, `custom_field_count_in_${modelAName}`);
    summary.customFieldCountModelB = getNumberField(row as Record<string, unknown>, `custom_field_count_in_${modelBName}`);
    summary.availableFieldCountModelA = getNumberField(row as Record<string, unknown>, `available_field_count_in_${modelAName}`);
    summary.availableFieldCountModelB = getNumberField(row as Record<string, unknown>, `available_field_count_in_${modelBName}`);
    summary.droppedFieldCountModelA = getNumberField(row as Record<string, unknown>, `dropped_field_count_in_${modelAName}`);
    summary.droppedFieldCountModelB = getNumberField(row as Record<string, unknown>, `dropped_field_count_in_${modelBName}`);
  }

  for (const row of sheets.JOIN_SUMMARY ?? []) {
    const key = buildSmodelTableLookupKey({ tableName: row.table_name, tableId: row.table_id });
    const summary = getSummary(key);
    const relationGroupsFieldA = `relation_groups_in_${leftSourceLabel}`;
    const relationGroupsFieldB = `relation_groups_in_${rightSourceLabel}`;
    const relationGroupDiffField = `relation_group_diff_${rightSourceLabel}_minus_${leftSourceLabel}`;
    const hasRelationGroupA = Object.prototype.hasOwnProperty.call(row, relationGroupsFieldA);
    const hasRelationGroupB = Object.prototype.hasOwnProperty.call(row, relationGroupsFieldB);
    const hasRelationGroupDiff = Object.prototype.hasOwnProperty.call(row, relationGroupDiffField);

    summary.joinCountModelA = hasRelationGroupA
      ? getNumberField(row as Record<string, unknown>, relationGroupsFieldA)
      : getNumberField(row as Record<string, unknown>, leftSourceLabel);
    summary.joinCountModelB = hasRelationGroupB
      ? getNumberField(row as Record<string, unknown>, relationGroupsFieldB)
      : getNumberField(row as Record<string, unknown>, rightSourceLabel);
    summary.joinCountDiff = hasRelationGroupDiff
      ? getNumberField(row as Record<string, unknown>, relationGroupDiffField)
      : getNumberField(row as Record<string, unknown>, `diff_${rightSourceLabel}_minus_${leftSourceLabel}`);
  }

  const joinDetailsByTableAndSource = new Map<string, Set<string>>();
  const appendJoinDetail = (tableKey: string, sourceLabel: string, detail: string) => {
    if (!tableKey || !sourceLabel || !detail) return;
    const mapKey = `${tableKey}__${sourceLabel}`;
    const existing = joinDetailsByTableAndSource.get(mapKey) ?? new Set<string>();
    existing.add(detail);
    joinDetailsByTableAndSource.set(mapKey, existing);
  };

  for (const row of sheets.JOINS_METADATA ?? []) {
    const sourceLabel = toSmodelText(row.source_file);
    const leftTableName = toSmodelText(row.left_table);
    const leftTableId = toSmodelText(row.left_table_id);
    const leftColumn = toSmodelText(row.left_column);
    const rightTableName = toSmodelText(row.right_table);
    const rightTableId = toSmodelText(row.right_table_id);
    const rightColumn = toSmodelText(row.right_column);
    const leftKey = buildSmodelTableLookupKey({ tableName: leftTableName, tableId: leftTableId });
    const rightKey = buildSmodelTableLookupKey({ tableName: rightTableName, tableId: rightTableId });
    const leftTarget = [rightTableName || rightTableId, rightColumn].filter(Boolean).join('.');
    const rightTarget = [leftTableName || leftTableId, leftColumn].filter(Boolean).join('.');

    appendJoinDetail(leftKey, sourceLabel, [leftColumn, leftTarget].filter(Boolean).join(' -> '));
    appendJoinDetail(rightKey, sourceLabel, [rightColumn, rightTarget].filter(Boolean).join(' -> '));
  }

  for (const [mapKey, joinDetails] of joinDetailsByTableAndSource.entries()) {
    const separatorIndex = mapKey.lastIndexOf('__');
    const tableKey = separatorIndex >= 0 ? mapKey.slice(0, separatorIndex) : mapKey;
    const sourceLabel = separatorIndex >= 0 ? mapKey.slice(separatorIndex + 2) : '';
    const summary = getSummary(tableKey);
    const detailText = Array.from(joinDetails).sort().join(' | ');
    if (sourceLabel === leftSourceLabel) {
      summary.joinFieldsModelA = detailText;
    } else if (sourceLabel === rightSourceLabel) {
      summary.joinFieldsModelB = detailText;
    }
  }

  for (const row of sheets.TABLE_QUERIES ?? []) {
    const key = buildSmodelTableLookupKey({ tableName: row.table_name, tableId: row.table_id });
    const summary = getSummary(key);
    summary.tableQueryDiff = getBooleanField(row.is_different);
    summary.leftTableQuery =
      getFirstMatchingFieldText(row as Record<string, unknown>, [`table_query_in_${modelAName}`, 'table_query_in_model_a']) ||
      summary.leftTableQuery;
    summary.rightTableQuery =
      getFirstMatchingFieldText(row as Record<string, unknown>, [`table_query_in_${modelBName}`, 'table_query_in_model_b']) ||
      summary.rightTableQuery;
  }

  for (const row of sheets.CUSTOM_TABLES ?? []) {
    const key = buildSmodelTableLookupKey({ tableName: row.table_name, tableId: row.table_id });
    const summary = getSummary(key);
    summary.tableQueryDiff = summary.tableQueryDiff || getBooleanField(row.is_different);
    summary.leftTableQuery =
      getFirstMatchingFieldText(row as Record<string, unknown>, [`table_query_in_${modelAName}`, 'table_query_in_model_a']) ||
      summary.leftTableQuery;
    summary.rightTableQuery =
      getFirstMatchingFieldText(row as Record<string, unknown>, [`table_query_in_${modelBName}`, 'table_query_in_model_b']) ||
      summary.rightTableQuery;
  }

  for (const row of sheets.HIDDEN_COLUMNS ?? []) {
    const key = buildSmodelTableLookupKey({ tableName: row.table_name, tableId: row.table_id });
    const summary = getSummary(key);
    const diffField = Object.keys(row).find((field) => field.startsWith('diff_count_in_'));
    summary.hiddenTotalModelA = getNumberField(row as Record<string, unknown>, 'hidden_total_in_model_a');
    summary.hiddenTotalModelB = getNumberField(row as Record<string, unknown>, 'hidden_total_in_model_b');
    summary.hiddenTotalDiff = getNumberField(row as Record<string, unknown>, `hidden_total_diff_${modelBName}_minus_${modelAName}`);
    summary.hiddenDiffSummaryModelA = formatSummaryList(row.column_names_in_model_a);
    summary.hiddenDiffSummaryModelB = formatSummaryList(row.column_names_in_model_b);
    summary.hiddenDiffCount = diffField ? getNumberField(row as Record<string, unknown>, diffField) : 0;
  }

  for (const row of sheets.DATATYPES ?? []) {
    const key = buildSmodelTableLookupKey({ tableName: row.table_name, tableId: row.table_id });
    const summary = getSummary(key);
    const diffField = Object.keys(row).find((field) => field.startsWith('diff_count_in_'));
    summary.datatypeDiffSummaryModelA = formatSummaryList(row.column_names_in_model_a);
    summary.datatypeDiffSummaryModelB = formatSummaryList(row.column_names_in_model_b);
    summary.datatypeDiffCount = diffField ? getNumberField(row as Record<string, unknown>, diffField) : 0;
  }

  return summaries;
};

const buildSmodelCompareRows = (
  leftRows: SmodelColumnRow[],
  rightRows: SmodelColumnRow[],
  tableSummaries: Map<string, SmodelTableSummary>
): SmodelCompareRow[] => {
  const summarizeColumnFieldDiffs = (
    leftTableRows: SmodelColumnRow[],
    rightTableRows: SmodelColumnRow[],
    getValue: (row: SmodelColumnRow) => string
  ) => {
    const leftByColumn = new Map(leftTableRows.map((row) => [normalizeSmodelKeyPart(row.columnName || row.columnId), row] as const));
    const rightByColumn = new Map(rightTableRows.map((row) => [normalizeSmodelKeyPart(row.columnName || row.columnId), row] as const));
    const columnKeys = Array.from(new Set([...leftByColumn.keys(), ...rightByColumn.keys()])).filter(Boolean).sort();
    const leftParts: string[] = [];
    const rightParts: string[] = [];

    for (const columnKey of columnKeys) {
      const leftRow = leftByColumn.get(columnKey);
      const rightRow = rightByColumn.get(columnKey);
      const label = leftRow?.columnName || rightRow?.columnName || columnKey;
      const leftValue = getValue(leftRow ?? ({} as SmodelColumnRow));
      const rightValue = getValue(rightRow ?? ({} as SmodelColumnRow));
      if (leftValue === rightValue) continue;
      leftParts.push(`${label}: ${leftValue || '-'}`);
      rightParts.push(`${label}: ${rightValue || '-'}`);
    }

    return { leftSummary: leftParts.join(' | '), rightSummary: rightParts.join(' | ') };
  };

  const leftTableMap = new Map<string, SmodelColumnRow[]>();
  const rightTableMap = new Map<string, SmodelColumnRow[]>();

  for (const row of leftRows) {
    const key = buildSmodelTableLookupKey({ tableName: row.tableName, tableId: row.tableId });
    leftTableMap.set(key, [...(leftTableMap.get(key) ?? []), row]);
  }
  for (const row of rightRows) {
    const key = buildSmodelTableLookupKey({ tableName: row.tableName, tableId: row.tableId });
    rightTableMap.set(key, [...(rightTableMap.get(key) ?? []), row]);
  }

  const allTableKeys = Array.from(new Set([...leftTableMap.keys(), ...rightTableMap.keys()])).sort();
  return allTableKeys.map((key) => {
    const leftRowsForTable = leftTableMap.get(key) ?? [];
    const rightRowsForTable = rightTableMap.get(key) ?? [];
    const left = leftRowsForTable[0];
    const right = rightRowsForTable[0];
    const summary = tableSummaries.get(key);
    const datatypeSummary = summarizeColumnFieldDiffs(leftRowsForTable, rightRowsForTable, (row) => row.dataType ?? '');
    const hiddenSummary = summarizeColumnFieldDiffs(leftRowsForTable, rightRowsForTable, (row) => row.hidden ?? '');
    const mismatchFields: string[] = [];
    const leftTableQuery = summary?.leftTableQuery || left?.tableQuery || '';
    const rightTableQuery = summary?.rightTableQuery || right?.tableQuery || '';
    const hasQueryDifference =
      Boolean(summary?.tableQueryDiff) ||
      leftTableQuery !== rightTableQuery ||
      (left?.tableExpression ?? '') !== (right?.tableExpression ?? '') ||
      (left?.datasetImportQuery ?? '') !== (right?.datasetImportQuery ?? '');

    if ((left?.tableType ?? '') !== (right?.tableType ?? '')) mismatchFields.push('table_type');
    if (hasQueryDifference) mismatchFields.push('table_query_diff');
    if ((summary?.columnCountDiff ?? 0) !== 0) mismatchFields.push('column_count');
    if ((summary?.joinCountDiff ?? 0) !== 0) mismatchFields.push('join_count');
    if ((summary?.hiddenDiffCount ?? 0) !== 0 || (summary?.hiddenTotalDiff ?? 0) !== 0) {
      mismatchFields.push('hidden_diff_total');
    }
    if ((summary?.datatypeDiffCount ?? 0) !== 0) mismatchFields.push('datatype_diff_total');

    return {
      key,
      datasetId: left?.datasetId || right?.datasetId || '',
      datasetName: left?.datasetName || right?.datasetName || '',
      schemaName: left?.schemaName || right?.schemaName || '',
      tableId: left?.tableId || right?.tableId || '',
      tableName: left?.tableName || right?.tableName || '',
      leftTableType: left?.tableType ?? '',
      rightTableType: right?.tableType ?? '',
      leftTableExpression: left?.tableExpression ?? '',
      rightTableExpression: right?.tableExpression ?? '',
      leftDataType: summary?.datatypeDiffSummaryModelA || datatypeSummary.leftSummary,
      rightDataType: summary?.datatypeDiffSummaryModelB || datatypeSummary.rightSummary,
      leftHidden: summary?.hiddenDiffSummaryModelA || hiddenSummary.leftSummary,
      rightHidden: summary?.hiddenDiffSummaryModelB || hiddenSummary.rightSummary,
      leftDatasetImportQuery: left?.datasetImportQuery ?? '',
      rightDatasetImportQuery: right?.datasetImportQuery ?? '',
      leftTableQuery,
      rightTableQuery,
      columnCountModelA: summary?.columnCountModelA ?? 0,
      columnCountModelB: summary?.columnCountModelB ?? 0,
      columnCountDiff: summary?.columnCountDiff ?? 0,
      fieldCountWithoutCustomModelA: summary?.fieldCountWithoutCustomModelA ?? 0,
      fieldCountWithoutCustomModelB: summary?.fieldCountWithoutCustomModelB ?? 0,
      customFieldCountModelA: summary?.customFieldCountModelA ?? 0,
      customFieldCountModelB: summary?.customFieldCountModelB ?? 0,
      availableFieldCountModelA: summary?.availableFieldCountModelA ?? 0,
      availableFieldCountModelB: summary?.availableFieldCountModelB ?? 0,
      droppedFieldCountModelA: summary?.droppedFieldCountModelA ?? 0,
      droppedFieldCountModelB: summary?.droppedFieldCountModelB ?? 0,
      joinCountModelA: summary?.joinCountModelA ?? 0,
      joinCountModelB: summary?.joinCountModelB ?? 0,
      joinCountDiff: summary?.joinCountDiff ?? 0,
      joinFieldsModelA: summary?.joinFieldsModelA ?? '',
      joinFieldsModelB: summary?.joinFieldsModelB ?? '',
      joinFieldsDisplay:
        [
          summary?.joinFieldsModelA ? `Model A: ${summary.joinFieldsModelA}` : '',
          summary?.joinFieldsModelB ? `Model B: ${summary.joinFieldsModelB}` : '',
        ]
          .filter(Boolean)
          .join(' || ') || '-',
      hiddenTotalModelA: summary?.hiddenTotalModelA ?? 0,
      hiddenTotalModelB: summary?.hiddenTotalModelB ?? 0,
      hiddenTotalDiff: summary?.hiddenTotalDiff ?? 0,
      tableQueryDiff: hasQueryDifference,
      hiddenDiffCount: summary?.hiddenDiffCount ?? 0,
      datatypeDiffCount: summary?.datatypeDiffCount ?? 0,
      mismatchFields,
      status: mismatchFields.length === 0 ? 'MATCH' : 'MISMATCH',
    };
  });
};

const buildSmodelRowsFromPythonMetadata = (
  sheets: PythonSmodelSheets,
  leftLabel: string,
  rightLabel: string,
  modelAName: string,
  modelBName: string
) => {
  const metadataRows = sheets.METADATA ?? [];
  const tableSummaries = buildSmodelTableSummaries(sheets, modelAName, modelBName, leftLabel, rightLabel);
  const normalize = (value: unknown) => toSmodelText(value);
  const toComparable = (row: PythonSmodelMetadataRow): SmodelColumnRow => ({
    key: [normalizeSmodelKeyPart(row.table_name || row.table_id), normalizeSmodelKeyPart(row.column_name || row.column_id)].join('|'),
    datasetId: normalize(row.dataset_id),
    datasetName: normalize(row.dataset_name),
    schemaName: normalize(row.schemaName),
    tableId: normalize(row.table_id),
    tableName: normalize(row.table_name),
    tableType: normalize(row.table_type),
    tableExpression: normalize(row.table_expression),
    columnId: normalize(row.column_id),
    columnName: normalize(row.column_name),
    displayName: normalize(row.displayName),
    description: normalize(row.description),
    dataType: normalize(row.dataType),
    hidden: normalize(row.hidden),
    expression: normalize(row.expression),
    datasetImportQuery: normalize(row.dataset_importQuery),
    tableImportQuery: normalize(row.table_importQuery),
    tableQuery: normalize(row.table_expression) || normalize(row.table_importQuery),
  });

  const leftRows = metadataRows.filter((row) => normalize(row.source_file) === leftLabel).map(toComparable);
  const rightRows = metadataRows.filter((row) => normalize(row.source_file) === rightLabel).map(toComparable);
  return buildSmodelCompareRows(leftRows, rightRows, tableSummaries);
};

export default function SmodelCompareWorkspace() {
  const [smodelLeftFile, setSmodelLeftFile] = useState<File | null>(null);
  const [smodelRightFile, setSmodelRightFile] = useState<File | null>(null);
  const [smodelCompareLoading, setSmodelCompareLoading] = useState(false);
  const [smodelError, setSmodelError] = useState('');
  const [smodelSuccess, setSmodelSuccess] = useState('');
  const [smodelRows, setSmodelRows] = useState<SmodelCompareRow[]>([]);
  const [smodelFilter, setSmodelFilter] = useState<SmodelFilter>('all');
  const [smodelSearch, setSmodelSearch] = useState('');
  const [smodelModelALabel, setSmodelModelALabel] = useState('Model A');
  const [smodelModelBLabel, setSmodelModelBLabel] = useState('Model B');
  const [selectedQueryPreviewKey, setSelectedQueryPreviewKey] = useState('');

  const canRunSmodelCompare = Boolean(smodelLeftFile && smodelRightFile);
  const visibleSmodelRows = smodelRows
    .filter((row) =>
      smodelFilter === 'all'
        ? true
        : smodelFilter === 'match'
          ? row.status === 'MATCH'
          : smodelFilter === 'query'
            ? row.tableQueryDiff
            : row.status !== 'MATCH'
    )
    .filter((row) => {
      const searchValue = normalizeSmodelKeyPart(smodelSearch);
      if (!searchValue) return true;
      return [row.tableName, row.datasetName, row.schemaName, row.tableId, row.mismatchFields.join(' ')]
        .map((value) => normalizeSmodelKeyPart(value))
        .some((value) => value.includes(searchValue));
    })
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'MISMATCH' ? -1 : 1;
      return left.tableName.localeCompare(right.tableName);
    });
  const selectedQueryPreviewRow =
    visibleSmodelRows.find((row) => row.key === selectedQueryPreviewKey) ??
    smodelRows.find((row) => row.key === selectedQueryPreviewKey) ??
    null;
  const selectedLeftQueryPreview = selectedQueryPreviewRow
    ? selectedQueryPreviewRow.leftTableQuery || buildDefaultTableQuery(selectedQueryPreviewRow.schemaName, selectedQueryPreviewRow.tableName)
    : '';
  const selectedRightQueryPreview = selectedQueryPreviewRow
    ? selectedQueryPreviewRow.rightTableQuery || buildDefaultTableQuery(selectedQueryPreviewRow.schemaName, selectedQueryPreviewRow.tableName)
    : '';

  const exportSmodelComparisonWorkbook = () => {
    const headers = ['Status', 'Table', 'Mismatch Fields', 'Total Field Count Model A', 'Total Field Count Model B', 'Total Field Count Diff', 'Field Count Without Custom Model A', 'Field Count Without Custom Model B', 'Custom Field Count Model A', 'Custom Field Count Model B', 'Available Field Count Model A', 'Available Field Count Model B', 'Dropped Field Count Model A', 'Dropped Field Count Model B', 'Joined Fields Internally', 'Joined Fields Internally Model A', 'Joined Fields Internally Model B', 'Direct Relationship Count Model A', 'Direct Relationship Count Model B', 'Direct Relationship Diff', 'Hidden Total Model A', 'Hidden Total Model B', 'Hidden Total Diff', 'Table Query Diff', 'Datatype Diff Total', 'Dataset ID', 'Dataset', 'Schema', 'Table ID', `${smodelModelALabel} Table Type`, `${smodelModelBLabel} Table Type`, `${smodelModelALabel} Table Expression`, `${smodelModelBLabel} Table Expression`, `${smodelModelALabel} Dataset Import Query`, `${smodelModelBLabel} Dataset Import Query`, `${smodelModelALabel} Table Query`, `${smodelModelBLabel} Table Query`];
    const rows = visibleSmodelRows.map((row) => [row.status, row.tableName, row.mismatchFields.join(', '), row.columnCountModelA, row.columnCountModelB, row.columnCountDiff, row.fieldCountWithoutCustomModelA, row.fieldCountWithoutCustomModelB, row.customFieldCountModelA, row.customFieldCountModelB, row.availableFieldCountModelA, row.availableFieldCountModelB, row.droppedFieldCountModelA, row.droppedFieldCountModelB, row.joinFieldsDisplay, row.joinFieldsModelA, row.joinFieldsModelB, row.joinCountModelA, row.joinCountModelB, row.joinCountDiff, row.hiddenTotalModelA, row.hiddenTotalModelB, row.hiddenTotalDiff, row.tableQueryDiff ? 'Yes' : 'No', row.datatypeDiffCount, row.datasetId, row.datasetName, row.schemaName, row.tableId, row.leftTableType, row.rightTableType, row.leftTableExpression, row.rightTableExpression, row.leftDatasetImportQuery, row.rightDatasetImportQuery, row.leftTableQuery, row.rightTableQuery]);
    const workbookXml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Smodel Compare"><Table><Row>${headers.map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join('')}</Row>${rows.map((row) => `<Row>${row.map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
    const blob = new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${toDownloadSafeName(smodelModelALabel)}_vs_${toDownloadSafeName(smodelModelBLabel)}_compare_table.xls`;
    link.click();
    URL.revokeObjectURL(url);
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
      const dataResponse = await fetch('/api/excel/sisense/smodel-compare-data', { method: 'POST', body: dataForm });
      const dataJson = (await dataResponse.json()) as { error?: string; model_a_label?: string; model_b_label?: string; model_a_name?: string; model_b_name?: string; sheets?: PythonSmodelSheets };
      if (!dataResponse.ok) throw new Error(dataJson.error || 'Failed to load Python comparison sheet data.');
      const leftLabel = dataJson.model_a_label || smodelLeftFile.name;
      const rightLabel = dataJson.model_b_label || smodelRightFile.name;
      const modelAName = dataJson.model_a_name || leftLabel;
      const modelBName = dataJson.model_b_name || rightLabel;
      setSmodelModelALabel(stripFileExtension(smodelLeftFile.name));
      setSmodelModelBLabel(stripFileExtension(smodelRightFile.name));
      const nextRows = buildSmodelRowsFromPythonMetadata(dataJson.sheets ?? {}, leftLabel, rightLabel, modelAName, modelBName);
      setSmodelRows(nextRows);
      setSmodelSearch('');
      setSelectedQueryPreviewKey(nextRows[0]?.key ?? '');
      setSmodelFilter('all');

      const formData = new FormData();
      formData.append('left', smodelLeftFile);
      formData.append('right', smodelRightFile);
      const response = await fetch('/api/excel/sisense/smodel-compare', { method: 'POST', body: formData });
      if (!response.ok) {
        let errorMessage = 'Failed to compare .smodel files.';
        try {
          const json = (await response.json()) as { error?: string };
          if (json.error) errorMessage = json.error;
        } catch {}
        throw new Error(errorMessage);
      }

      const disposition = response.headers.get('Content-Disposition');
      const suggestedFilename =
        parseFilenameFromContentDisposition(disposition) ||
        `${toDownloadSafeName(smodelLeftFile.name)}_vs_${toDownloadSafeName(smodelRightFile.name)}_comparison.xlsx`;
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
        <SmodelFilePicker label="Model A" title="Baseline Smodel" helpText="Upload the first Sisense model export file." tone="blue" file={smodelLeftFile} onChange={setSmodelLeftFile} />
        <SmodelFilePicker label="Model B" title="Target Smodel" helpText="Upload the second Sisense model export file." tone="sky" file={smodelRightFile} onChange={setSmodelRightFile} />
      </div>

      <div className="mt-6 flex justify-center">
        <button type="button" onClick={handleSmodelCompare} disabled={!canRunSmodelCompare || smodelCompareLoading} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
          <ArrowDownUp size={16} />
          {smodelCompareLoading ? 'Building Comparison Table and Workbook...' : 'Build Comparison Table and Download Workbook'}
        </button>
      </div>

      {smodelError ? <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>{smodelError}</p></div> : null}
      {smodelSuccess ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{smodelSuccess}</div> : null}

      {smodelRows.length ? (
        <div className="mt-6 overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Smodel Side-By-Side</p>
                <h3 className="mt-1 text-xl font-black tracking-tight">Model A vs Model B table comparison</h3>
                <p className="mt-1 text-sm text-slate-500">Grouped by table name. Shows field counts, joins, query differences, hidden totals, and datatype differences.</p>
              </div>
              <div className="grid gap-2 text-xs font-bold">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">Tables: {smodelRows.length}</span>
                <span className="rounded-full bg-blue-100 px-3 py-1.5 text-blue-700">Query Changes: {smodelRows.filter((row) => row.tableQueryDiff).length}</span>
                <span className="rounded-full bg-rose-100 px-3 py-1.5 text-rose-700">Mismatches: {smodelRows.filter((row) => row.status === 'MISMATCH').length}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
                  <button type="button" onClick={() => setSmodelFilter('all')} className={`rounded-xl px-3 py-2 ${smodelFilter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>All Tables</button>
                  <button type="button" onClick={() => setSmodelFilter('match')} className={`rounded-xl px-3 py-2 ${smodelFilter === 'match' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Match Only</button>
                  <button type="button" onClick={() => setSmodelFilter('mismatch')} className={`rounded-xl px-3 py-2 ${smodelFilter === 'mismatch' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Mismatches Only</button>
                  <button type="button" onClick={() => setSmodelFilter('query')} className={`rounded-xl px-3 py-2 ${smodelFilter === 'query' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Query Changes</button>
                </div>
                <input
                  type="text"
                  value={smodelSearch}
                  onChange={(event) => setSmodelSearch(event.target.value)}
                  placeholder="Search table, schema, dataset, mismatch..."
                  className="min-w-[260px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button type="button" onClick={exportSmodelComparisonWorkbook} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">Download Compare Table</button>
            </div>
            <p className="mt-3 text-xs font-medium text-slate-500">Showing {visibleSmodelRows.length} of {smodelRows.length} tables.</p>
          </div>

          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-950 text-white">
                <tr>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Status</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Table</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Mismatch Fields</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Total Field Count Model A</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Total Field Count Model B</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Total Field Count Diff</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Field Count Without Custom Model A</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Field Count Without Custom Model B</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Custom Field Count Model A</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Custom Field Count Model B</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Available Field Count Model A</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Available Field Count Model B</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Dropped Field Count Model A</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Dropped Field Count Model B</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold min-w-[24rem]">Joined Fields Internally</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Direct Relationship Count Model A</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Direct Relationship Count Model B</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Direct Relationship Diff</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Hidden Total Model A</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Hidden Total Model B</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Hidden Total Diff</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Table Query Diff</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold">Datatype Diff Total</th>
                </tr>
              </thead>
              <tbody>
                {visibleSmodelRows.map((row) => (
                  <tr key={row.key} className={row.status === 'MATCH' ? 'bg-white' : 'bg-rose-50/40'}>
                    <td className="border border-slate-200 px-3 py-2"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] ${row.status === 'MATCH' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{row.status}</span></td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.tableName || '-'}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">
                      {row.mismatchFields.length ? (
                        <div className="flex min-w-[12rem] flex-wrap gap-1.5">
                          {row.mismatchFields.map((field) => (
                            <span
                              key={`${row.key}-${field}`}
                              className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold leading-4 text-rose-700"
                            >
                              {formatMismatchFieldLabel(field)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.columnCountModelA}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.columnCountModelB}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.columnCountDiff}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.fieldCountWithoutCustomModelA}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.fieldCountWithoutCustomModelB}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.customFieldCountModelA}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.customFieldCountModelB}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.availableFieldCountModelA}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.availableFieldCountModelB}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.droppedFieldCountModelA}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.droppedFieldCountModelB}</td>
                    <td className="border border-slate-200 px-3 py-2 align-top text-slate-700">
                      {row.joinFieldsModelA || row.joinFieldsModelB ? (
                        <div className="min-w-[24rem] max-w-[32rem] space-y-3">
                          {row.joinFieldsModelA ? (
                            <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2">
                              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Model A</p>
                              <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-700">
                                Direct Relationships: {row.joinCountModelA}
                              </p>
                              <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-700">
                                Joined Keys Internally: {summarizeJoinKeys(row.joinFieldsModelA).join(', ') || '-'}
                              </p>
                              <div className="mt-1 space-y-1">
                                {splitJoinFieldDetails(row.joinFieldsModelA).map((item) => (
                                  <div key={`a-${row.key}-${item}`} className="rounded-md bg-white/80 px-2 py-1 font-mono text-[11px] leading-5 text-slate-700">
                                    {item}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {row.joinFieldsModelB ? (
                            <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2">
                              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">Model B</p>
                              <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-700">
                                Direct Relationships: {row.joinCountModelB}
                              </p>
                              <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-700">
                                Joined Keys Internally: {summarizeJoinKeys(row.joinFieldsModelB).join(', ') || '-'}
                              </p>
                              <div className="mt-1 space-y-1">
                                {splitJoinFieldDetails(row.joinFieldsModelB).map((item) => (
                                  <div key={`b-${row.key}-${item}`} className="rounded-md bg-white/80 px-2 py-1 font-mono text-[11px] leading-5 text-slate-700">
                                    {item}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.joinCountModelA}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.joinCountModelB}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.joinCountDiff}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.hiddenTotalModelA}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.hiddenTotalModelB}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{row.hiddenTotalDiff}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">
                      <div className="flex flex-col items-start gap-2">
                        <span>{row.tableQueryDiff ? 'Yes' : 'No'}</span>
                        {row.tableQueryDiff ? (
                          <button
                            type="button"
                            onClick={() => setSelectedQueryPreviewKey(row.key)}
                            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition ${
                              selectedQueryPreviewKey === row.key
                                ? 'bg-slate-900 text-white'
                                : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            Inspect
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">
                      {row.datatypeDiffCount}
                      {row.datatypeDiffCount > 0 ? (
                        <span className="text-[11px] text-slate-500">
                          {` (${summarizeDatatypeDiffFields(row.leftDataType, row.rightDataType) || 'field names unavailable'})`}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {visibleSmodelRows.length === 0 ? <tr><td colSpan={23} className="border border-slate-200 px-4 py-8 text-center text-sm text-slate-500">No tables found for the selected filter.</td></tr> : null}
              </tbody>
            </table>
          </div>

          {selectedQueryPreviewRow ? (
            <div className="border-t border-slate-200 bg-slate-50/70 px-6 py-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.25em] text-blue-600">Query Preview</p>
                  <h4 className="mt-1 text-lg font-black tracking-tight text-slate-900">{selectedQueryPreviewRow.tableName || 'Selected Table'}</h4>
                  <p className="mt-1 text-sm text-slate-500">Actual query text from both models for easier visual comparison. Query text is typically available for custom or query-backed tables. If metadata query fields are blank, the preview falls back to the Python compare query tabs.</p>
                </div>
                <div className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">
                  {selectedQueryPreviewRow.tableQueryDiff ? 'Query mismatch detected' : 'Queries match'}
                </div>
              </div>

              {(selectedQueryPreviewRow.hiddenTotalDiff !== 0 || selectedQueryPreviewRow.hiddenDiffCount !== 0) ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Hidden columns:
                  {` Model A = ${selectedQueryPreviewRow.hiddenTotalModelA}, Model B = ${selectedQueryPreviewRow.hiddenTotalModelB}, Diff = ${selectedQueryPreviewRow.hiddenTotalDiff}.`}
                  {selectedQueryPreviewRow.hiddenDiffCount === 0 ? ' The total hidden count changed even though the per-column hidden-difference list is empty.' : ''}
                </div>
              ) : null}

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <div className="rounded-[24px] border border-blue-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-600">{smodelModelALabel}</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Table Query</p>
                  <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100 whitespace-pre-wrap break-words">
                    {selectedLeftQueryPreview || 'No table query found in Model A for this table.'}
                  </pre>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Table Expression</p>
                  <pre className="mt-3 max-h-48 overflow-auto rounded-2xl bg-slate-100 p-4 text-xs leading-6 text-slate-700 whitespace-pre-wrap break-words">
                    {selectedQueryPreviewRow.leftTableExpression || 'No table expression found in Model A.'}
                  </pre>
                </div>

                <div className="rounded-[24px] border border-sky-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-600">{smodelModelBLabel}</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Table Query</p>
                  <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100 whitespace-pre-wrap break-words">
                    {selectedRightQueryPreview || 'No table query found in Model B for this table.'}
                  </pre>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Table Expression</p>
                  <pre className="mt-3 max-h-48 overflow-auto rounded-2xl bg-slate-100 p-4 text-xs leading-6 text-slate-700 whitespace-pre-wrap break-words">
                    {selectedQueryPreviewRow.rightTableExpression || 'No table expression found in Model B.'}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SmodelFilePicker({
  label,
  title,
  helpText,
  tone,
  file,
  onChange,
}: {
  label: string;
  title: string;
  helpText: string;
  tone: 'blue' | 'sky';
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const toneClasses = tone === 'sky' ? 'border-sky-200 bg-sky-50/60 hover:border-sky-400 hover:bg-sky-50' : 'border-blue-200 bg-blue-50/50 hover:border-blue-400 hover:bg-blue-50';
  return (
    <label className={`block rounded-[28px] border border-dashed p-6 transition ${toneClasses}`}>
      <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-500">{helpText}</p>
      <input type="file" accept=".smodel,.json" className="mt-4 block w-full text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      <p className="mt-3 text-xs font-medium text-slate-500">{file ? file.name : 'No file selected yet.'}</p>
    </label>
  );
}
