interface SmodelColumn {
  oid?: string;
  id?: string;
  name?: string;
  [key: string]: unknown;
}

interface SmodelTable {
  oid?: string;
  id?: string;
  name?: string;
  schemaName?: string;
  columns?: SmodelColumn[];
  [key: string]: unknown;
}

interface SmodelSchema {
  tables?: SmodelTable[];
  [key: string]: unknown;
}

interface SmodelDataset {
  oid?: string;
  name?: string;
  fullname?: string;
  database?: string;
  schemaName?: string;
  connection?: {
    name?: string | null;
    provider?: string | null;
    schema?: string | null;
    [key: string]: unknown;
  };
  schema?: SmodelSchema;
  [key: string]: unknown;
}

interface SmodelRelationRef {
  dataset?: string;
  table?: string;
  column?: string;
  [key: string]: unknown;
}

interface SmodelRelation {
  oid?: string;
  columns?: SmodelRelationRef[];
  [key: string]: unknown;
}

export interface SmodelTransferRelationPreview {
  relationOid: string;
  relationType: string;
  summary: string;
  json: string;
}

export interface SmodelTransferColumnDiff {
  added: string[];
  preservedTargetOnly: string[];
  unchanged: string[];
  renamed: Array<{ from: string; to: string }>;
}

export interface SmodelDocument {
  title?: string;
  datasets?: SmodelDataset[];
  relations?: SmodelRelation[];
  [key: string]: unknown;
}

export interface SmodelTransferPreview {
  tableName: string;
  sourceModelTitle: string;
  targetModelTitle: string;
  sourceDatasetName: string;
  targetDatasetName: string;
  targetTableFound: boolean;
  sourceColumnCount: number;
  previousTargetColumnCount: number;
  updatedTargetColumnCount: number;
  columnDiff: SmodelTransferColumnDiff;
  sourceTableJson: string;
  previousTargetTableJson: string;
  updatedTargetTableJson: string;
  previousTargetRelationCount: number;
  updatedTargetRelationCount: number;
  copiedRelationCount: number;
  sourceRelations: SmodelTransferRelationPreview[];
  previousTargetRelations: SmodelTransferRelationPreview[];
  copiedRelations: SmodelTransferRelationPreview[];
  warnings: string[];
}

export interface SmodelTransferResult {
  transformedModel: SmodelDocument;
  preview: SmodelTransferPreview;
}

export interface SmodelTableCandidate {
  datasetIndex: number;
  tableIndex: number;
  datasetName: string;
  schemaName: string;
  tableName: string;
  tableId: string;
  tableOid: string;
  tableType: string;
}

export interface SmodelDatasetCandidate {
  datasetIndex: number;
  datasetName: string;
  schemaName: string;
  tableCount: number;
}

export interface SmodelTransferCandidatesResult {
  sourceMatches: SmodelTableCandidate[];
  targetMatches: SmodelTableCandidate[];
  targetDatasets: SmodelDatasetCandidate[];
}

export interface SmodelTransferSelection {
  sourceDatasetIndex?: number;
  sourceTableIndex?: number;
  targetDatasetIndex?: number;
  targetTableIndex?: number;
  excludedAddedColumnNames?: string[];
}

const createTargetDatasetForNewTable = (sourceDataset: SmodelDataset): SmodelDataset => {
  const clonedDataset = cloneJson(sourceDataset);
  return {
    ...clonedDataset,
    schema: {
      ...(clonedDataset.schema ?? {}),
      tables: [],
    },
  };
};

interface ResolvedTableLocation {
  dataset: SmodelDataset;
  datasetIndex: number;
  table: SmodelTable;
  tableIndex: number;
}

const normalizeName = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const getTableName = (table: SmodelTable) => String(table.name ?? table.id ?? '').trim();

const getColumnName = (column: SmodelColumn) => String(column.name ?? column.id ?? '').trim();

const isUuidLike = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());

const getDatasetDisplayName = (dataset: SmodelDataset) => {
  const rawName = String(dataset.name ?? '').trim();
  if (rawName && !isUuidLike(rawName)) return rawName;

  const connectionName = String(dataset.connection?.name ?? '').trim();
  if (connectionName) return connectionName;

  const database = String(dataset.database ?? '').trim();
  const schemaName = String(dataset.schemaName ?? '').trim();
  if (database && schemaName) return `${database}.${schemaName}`;
  if (database) return database;
  if (schemaName) return schemaName;

  const fullname = String(dataset.fullname ?? '').trim().replace(/^[a-z]+:/i, '');
  if (fullname && !isUuidLike(fullname)) return fullname;

  if (rawName) return rawName;
  return String(dataset.oid ?? '').trim();
};

const toTableCandidate = (
  dataset: SmodelDataset,
  datasetIndex: number,
  table: SmodelTable,
  tableIndex: number
): SmodelTableCandidate => ({
  datasetIndex,
  tableIndex,
  datasetName: getDatasetDisplayName(dataset),
  schemaName: String(table.schemaName ?? dataset.schemaName ?? ''),
  tableName: getTableName(table),
  tableId: String(table.id ?? ''),
  tableOid: String(table.oid ?? ''),
  tableType: String(table.type ?? ''),
});

const toDatasetCandidate = (
  dataset: SmodelDataset,
  datasetIndex: number
): SmodelDatasetCandidate => ({
  datasetIndex,
  datasetName: getDatasetDisplayName(dataset),
  schemaName: String(dataset.schemaName ?? ''),
  tableCount: Array.isArray(dataset.schema?.tables) ? dataset.schema.tables.length : 0,
});

const findTableByIndexes = (
  model: SmodelDocument,
  datasetIndex: number | undefined,
  tableIndex: number | undefined
): ResolvedTableLocation | null => {
  if (!Number.isInteger(datasetIndex) || !Number.isInteger(tableIndex)) return null;
  const dataset = model.datasets?.[datasetIndex as number];
  const table = dataset?.schema?.tables?.[tableIndex as number];
  if (!dataset || !table) return null;
  return { dataset, datasetIndex: datasetIndex as number, table, tableIndex: tableIndex as number };
};

export function findTablesByExactName(model: SmodelDocument, requestedTableName: string): SmodelTableCandidate[] {
  const requested = requestedTableName.trim();
  if (!requested) return [];

  const matches: SmodelTableCandidate[] = [];
  const datasets = Array.isArray(model.datasets) ? model.datasets : [];
  for (const [datasetIndex, dataset] of datasets.entries()) {
    const tables = Array.isArray(dataset.schema?.tables) ? dataset.schema?.tables : [];
    for (const [tableIndex, table] of tables.entries()) {
      if (getTableName(table) === requested) {
        matches.push(toTableCandidate(dataset, datasetIndex, table, tableIndex));
      }
    }
  }
  return matches;
}

export function listSmodelTransferCandidates(
  sourceModel: SmodelDocument,
  targetModel: SmodelDocument,
  requestedTableName: string
): SmodelTransferCandidatesResult {
  const targetDatasets = Array.isArray(targetModel.datasets)
    ? targetModel.datasets.map((dataset, datasetIndex) => toDatasetCandidate(dataset, datasetIndex))
    : [];

  return {
    sourceMatches: findTablesByExactName(sourceModel, requestedTableName),
    targetMatches: findTablesByExactName(targetModel, requestedTableName),
    targetDatasets,
  };
}

const resolveTargetDatasetIndex = (
  model: SmodelDocument,
  sourceTableLocation: ResolvedTableLocation,
  targetTableLocation: ResolvedTableLocation | null,
  selectedTargetDatasetIndex?: number
) => {
  if (targetTableLocation) return targetTableLocation.datasetIndex;
  if (Number.isInteger(selectedTargetDatasetIndex) && model.datasets?.[selectedTargetDatasetIndex as number]) {
    return selectedTargetDatasetIndex as number;
  }

  const sourceSchemaName = normalizeName(sourceTableLocation.table.schemaName ?? sourceTableLocation.dataset.schemaName);
  const datasets = Array.isArray(model.datasets) ? model.datasets : [];
  const schemaMatches = datasets.filter((dataset) => normalizeName(dataset.schemaName) === sourceSchemaName);
  if (schemaMatches.length === 1) {
    return datasets.indexOf(schemaMatches[0]);
  }
  return -1;
};

const buildDisplayLookups = (model: SmodelDocument) => {
  const datasetsByOid = new Map<string, SmodelDataset>();
  const tableByOid = new Map<string, { dataset: SmodelDataset; table: SmodelTable }>();
  const columnByOid = new Map<string, { table: SmodelTable; column: SmodelColumn }>();

  for (const dataset of model.datasets ?? []) {
    if (dataset.oid) datasetsByOid.set(dataset.oid, dataset);
    for (const table of dataset.schema?.tables ?? []) {
      if (table.oid) tableByOid.set(table.oid, { dataset, table });
      for (const column of table.columns ?? []) {
        if (column.oid) columnByOid.set(column.oid, { table, column });
      }
    }
  }

  return { datasetsByOid, tableByOid, columnByOid };
};

const formatRelationRef = (
  ref: SmodelRelationRef,
  lookups: ReturnType<typeof buildDisplayLookups>
) => {
  const dataset = (ref.dataset ? lookups.datasetsByOid.get(ref.dataset) : null)
    ?? (ref.table ? lookups.tableByOid.get(ref.table)?.dataset : null);
  const tableEntry = ref.table ? lookups.tableByOid.get(ref.table) : null;
  const columnEntry = ref.column ? lookups.columnByOid.get(ref.column) : null;

  const datasetName = String(dataset?.name ?? dataset?.oid ?? ref.dataset ?? '');
  const schemaName = String(tableEntry?.table.schemaName ?? dataset?.schemaName ?? '');
  const tableName = getTableName(tableEntry?.table ?? {});
  const columnName = getColumnName(columnEntry?.column ?? {});

  return [datasetName, schemaName, tableName, columnName]
    .filter((part) => String(part).trim().length > 0)
    .join(' / ');
};

const buildRelationPreviews = (
  relations: SmodelRelation[],
  model: SmodelDocument
): SmodelTransferRelationPreview[] => {
  const lookups = buildDisplayLookups(model);
  return relations.map((relation) => ({
    relationOid: String(relation.oid ?? ''),
    relationType: String(relation.type ?? ''),
    summary: (relation.columns ?? []).map((ref) => formatRelationRef(ref, lookups)).join(' <-> '),
    json: prettyJson(relation),
  }));
};

const dedupeColumnsByName = (
  columns: SmodelColumn[],
  tableName: string
) => {
  const seen = new Set<string>();
  const warnings: string[] = [];
  const uniqueColumns: SmodelColumn[] = [];

  for (const column of columns) {
    const normalizedColumnName = normalizeName(getColumnName(column));
    if (!normalizedColumnName) {
      uniqueColumns.push(column);
      continue;
    }
    if (seen.has(normalizedColumnName)) {
      warnings.push(`Skipped duplicate column "${getColumnName(column)}" while transferring table "${tableName}".`);
      continue;
    }
    seen.add(normalizedColumnName);
    uniqueColumns.push(column);
  }

  return { columns: uniqueColumns, warnings };
};

const sanitizeTupleTransformations = (
  table: SmodelTable,
  tableName: string
) => {
  const keptColumnOids = new Set((table.columns ?? []).map((column) => String(column.oid ?? '')).filter(Boolean));
  const currentNamesByColumnOid = new Map<string, string>();
  const usedNames = new Set<string>();
  const warnings: string[] = [];

  for (const column of table.columns ?? []) {
    const columnOid = String(column.oid ?? '').trim();
    const normalizedColumnName = normalizeName(getColumnName(column));
    if (columnOid && normalizedColumnName) {
      currentNamesByColumnOid.set(columnOid, normalizedColumnName);
      usedNames.add(normalizedColumnName);
    }
  }

  const sanitizedTransforms = [];
  for (const transform of table.tupleTransformations ?? []) {
    const transformType = String(transform?.type ?? '').trim();
    const args = (transform?.arguments ?? {}) as Record<string, unknown>;
    const columnOid = String(args.column ?? '').trim();

    if ((transformType === 'dont-import' || transformType === 'change-data-type' || transformType === 'rename-column') && columnOid && !keptColumnOids.has(columnOid)) {
      warnings.push(`Skipped ${transformType} transformation for a removed column while transferring table "${tableName}".`);
      continue;
    }

    if (transformType === 'rename-column' && columnOid) {
      const currentName = currentNamesByColumnOid.get(columnOid) ?? '';
      const requestedName = normalizeName(args.name);
      if (!requestedName) {
        sanitizedTransforms.push(transform);
        continue;
      }
      if (requestedName !== currentName && usedNames.has(requestedName)) {
        warnings.push(`Skipped rename-column transformation to "${String(args.name ?? '')}" because that name already exists in table "${tableName}".`);
        continue;
      }
      if (currentName) usedNames.delete(currentName);
      usedNames.add(requestedName);
      currentNamesByColumnOid.set(columnOid, requestedName);
      sanitizedTransforms.push(transform);
      continue;
    }

    if (transformType === 'add-column') {
      const requestedName = normalizeName(args.name ?? args.columnName);
      if (!requestedName) {
        sanitizedTransforms.push(transform);
        continue;
      }
      if (usedNames.has(requestedName)) {
        warnings.push(`Skipped target-specific add-column transformation "${String(args.name ?? args.columnName ?? '')}" because the source table already replaces that column in table "${tableName}".`);
        continue;
      }
      usedNames.add(requestedName);
      sanitizedTransforms.push(transform);
      continue;
    }

    sanitizedTransforms.push(transform);
  }

  return { tupleTransformations: sanitizedTransforms, warnings };
};

const getEffectiveTableColumnNames = (table: SmodelTable) => {
  const currentNamesByColumnOid = new Map<string, string>();
  const names: string[] = [];

  for (const column of table.columns ?? []) {
    const columnOid = String(column.oid ?? '').trim();
    const columnName = String(getColumnName(column) ?? '').trim();
    if (!columnName) continue;
    if (columnOid) {
      currentNamesByColumnOid.set(columnOid, columnName);
    }
    names.push(columnName);
  }

  for (const transform of table.tupleTransformations ?? []) {
    const transformType = String(transform?.type ?? '').trim();
    const args = (transform?.arguments ?? {}) as Record<string, unknown>;

    if (transformType === 'rename-column') {
      const columnOid = String(args.column ?? '').trim();
      const requestedName = String(args.name ?? '').trim();
      if (!columnOid || !requestedName) continue;

      const previousName = currentNamesByColumnOid.get(columnOid);
      if (previousName) {
        const previousIndex = names.indexOf(previousName);
        if (previousIndex >= 0) names[previousIndex] = requestedName;
      }
      currentNamesByColumnOid.set(columnOid, requestedName);
      continue;
    }

    if (transformType === 'dont-import') {
      const columnOid = String(args.column ?? '').trim();
      if (!columnOid) continue;

      const previousName = currentNamesByColumnOid.get(columnOid);
      if (!previousName) continue;

      const previousIndex = names.indexOf(previousName);
      if (previousIndex >= 0) names.splice(previousIndex, 1);
      currentNamesByColumnOid.delete(columnOid);
      continue;
    }

    if (transformType === 'add-column') {
      const requestedName = String(args.name ?? args.columnName ?? '').trim();
      if (requestedName) names.push(requestedName);
    }
  }

  return names.filter((name) => name.trim().length > 0);
};

const getColumnIdentityKey = (column: SmodelColumn) => {
  const normalizedOid = normalizeName(column.oid);
  if (normalizedOid) return `oid:${normalizedOid}`;

  const normalizedId = normalizeName(column.id);
  if (normalizedId) return `id:${normalizedId}`;

  const normalizedName = normalizeName(getColumnName(column));
  if (normalizedName) return `name:${normalizedName}`;

  return '';
};

const getColumnLookupKeys = (column: SmodelColumn) => {
  const keys: string[] = [];
  const seen = new Set<string>();
  const pushKey = (prefix: string, value: unknown) => {
    const normalizedValue = normalizeName(value);
    if (!normalizedValue) return;
    const key = `${prefix}:${normalizedValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  pushKey('oid', column.oid);
  pushKey('id', column.id);
  pushKey('name', getColumnName(column));
  return keys;
};

const buildColumnLookup = (columns: SmodelColumn[]) => {
  const lookup = new Map<string, SmodelColumn>();
  for (const column of columns) {
    for (const key of getColumnLookupKeys(column)) {
      if (!lookup.has(key)) lookup.set(key, column);
    }
  }
  return lookup;
};

const getEffectiveColumnEntries = (table: SmodelTable) => {
  const entries: Array<{ key: string; name: string }> = [];
  const indexByKey = new Map<string, number>();

  const removeEntryByKey = (key: string) => {
    const index = indexByKey.get(key);
    if (index === undefined || index < 0) return;

    entries.splice(index, 1);
    indexByKey.delete(key);
    for (let currentIndex = index; currentIndex < entries.length; currentIndex += 1) {
      indexByKey.set(entries[currentIndex].key, currentIndex);
    }
  };

  for (const column of table.columns ?? []) {
    const key = getColumnIdentityKey(column);
    const name = String(getColumnName(column) ?? '').trim();
    if (!key || !name) continue;
    indexByKey.set(key, entries.length);
    entries.push({ key, name });
  }

  for (const transform of table.tupleTransformations ?? []) {
    const transformType = String(transform?.type ?? '').trim();
    const args = (transform?.arguments ?? {}) as Record<string, unknown>;

    if (transformType === 'rename-column') {
      const columnKey = normalizeName(args.column) ? `oid:${normalizeName(args.column)}` : '';
      const requestedName = String(args.name ?? '').trim();
      const index = columnKey ? indexByKey.get(columnKey) : undefined;
      if (index !== undefined && index >= 0 && requestedName) {
        entries[index] = { ...entries[index], name: requestedName };
      }
      continue;
    }

    if (transformType === 'dont-import') {
      const columnKey = normalizeName(args.column) ? `oid:${normalizeName(args.column)}` : '';
      if (columnKey) {
        removeEntryByKey(columnKey);
      }
      continue;
    }

    if (transformType === 'add-column') {
      const requestedName = String(args.name ?? args.columnName ?? '').trim();
      if (!requestedName) continue;
      const key = `add:${normalizeName(requestedName)}`;
      indexByKey.set(key, entries.length);
      entries.push({ key, name: requestedName });
    }
  }

  return entries.filter((entry) => entry.name.trim().length > 0);
};

const buildColumnDiff = (
  previousTargetTable: SmodelTable | null,
  updatedTargetTable: SmodelTable
): SmodelTransferColumnDiff => {
  const previousEntries = getEffectiveColumnEntries(previousTargetTable ?? {});
  const updatedEntries = getEffectiveColumnEntries(updatedTargetTable);
  const previousMap = new Map(previousEntries.map((entry) => [entry.key, entry.name] as const));
  const updatedMap = new Map(updatedEntries.map((entry) => [entry.key, entry.name] as const));

  const added: string[] = [];
  const preservedTargetOnly: string[] = [];
  const unchanged: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];

  for (const [key, name] of updatedMap.entries()) {
    const previousName = previousMap.get(key);
    if (!previousName) {
      added.push(name);
      continue;
    }
    if (normalizeName(previousName) === normalizeName(name)) unchanged.push(name);
    else renamed.push({ from: previousName, to: name });
  }

  for (const [key, name] of previousMap.entries()) {
    if (!updatedMap.has(key)) preservedTargetOnly.push(name);
  }

  const sorter = (left: string, right: string) => left.localeCompare(right);
  const renameSorter = (left: { from: string; to: string }, right: { from: string; to: string }) =>
    left.to.localeCompare(right.to);
  added.sort(sorter);
  preservedTargetOnly.sort(sorter);
  unchanged.sort(sorter);
  renamed.sort(renameSorter);

  return { added, preservedTargetOnly, unchanged, renamed };
};

const validateTableSchema = (table: SmodelTable) => {
  const effectiveNames = getEffectiveTableColumnNames(table);
  const counts = new Map<string, { original: string; count: number }>();

  for (const name of effectiveNames) {
    const normalizedName = normalizeName(name);
    const existing = counts.get(normalizedName);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(normalizedName, { original: name, count: 1 });
    }
  }

  const duplicates = [...counts.values()]
    .filter((entry) => entry.count > 1)
    .map((entry) => entry.original)
    .sort((left, right) => left.localeCompare(right));

  if (duplicates.length) {
    throw new Error(
      `Invalid table schema. Table ${getTableName(table) || table.id || '(unknown)'} contains duplicate column names after transformations: ${duplicates.join(', ')}.`
    );
  }
};

const buildRelationSignature = (relation: SmodelRelation) =>
  JSON.stringify({
    type: relation.type ?? null,
    columns: (relation.columns ?? []).map((column) => ({
      dataset: column.dataset ?? null,
      table: column.table ?? null,
      column: column.column ?? null,
    })),
  });

const isBinaryRelation = (relation: SmodelRelation) => (relation.columns ?? []).length === 2;

const prepareTransferredTable = (
  sourceTable: SmodelTable,
  fallbackTableName: string
): { table: SmodelTable; warnings: string[] } => {
  const warnings: string[] = [];
  const preparedTable = cloneJson(sourceTable);
  const deduped = dedupeColumnsByName(
    cloneJson(preparedTable.columns ?? []),
    getTableName(sourceTable) || fallbackTableName
  );

  warnings.push(...deduped.warnings);
  preparedTable.columns = deduped.columns;

  const sanitizedTransforms = sanitizeTupleTransformations(
    preparedTable,
    getTableName(sourceTable) || fallbackTableName
  );
  warnings.push(...sanitizedTransforms.warnings);
  preparedTable.tupleTransformations = sanitizedTransforms.tupleTransformations;

  return { table: preparedTable, warnings };
};

const retargetTransferredTable = (
  sourceTable: SmodelTable,
  targetDataset: SmodelDataset,
  previousTargetTable: SmodelTable | null
): { table: SmodelTable; warnings: string[] } => {
  const retargetedTable = cloneJson(sourceTable);
  const sourceColumns = sourceTable.columns ?? [];
  const previousColumns = previousTargetTable?.columns ?? [];
  const sourceColumnsByLookup = buildColumnLookup(sourceColumns);
  const previousColumnsByLookup = buildColumnLookup(previousColumns);
  const remappedColumnOids = new Map<string, string>();
  const preservedTargetOnlyColumnOids = new Set<string>();
  const sourceColumnKeys = new Set(sourceColumns.flatMap((column) => getColumnLookupKeys(column)));

  retargetedTable.schemaName = String(previousTargetTable?.schemaName ?? targetDataset.schemaName ?? retargetedTable.schemaName ?? '');
  if (previousTargetTable?.oid) retargetedTable.oid = previousTargetTable.oid;
  if (previousTargetTable?.id) retargetedTable.id = previousTargetTable.id;
  if (previousTargetTable?.vTag) retargetedTable.vTag = previousTargetTable.vTag;
  if (previousTargetTable && 'role' in previousTargetTable) retargetedTable.role = previousTargetTable.role;
  if (previousTargetTable && 'isRoleBySystem' in previousTargetTable) retargetedTable.isRoleBySystem = previousTargetTable.isRoleBySystem;

  retargetedTable.columns = (retargetedTable.columns ?? []).map((column) => {
    const lookupKeys = getColumnLookupKeys(column);
    const sourceColumn = lookupKeys.map((key) => sourceColumnsByLookup.get(key)).find(Boolean);
    const previousColumn = lookupKeys.map((key) => previousColumnsByLookup.get(key)).find(Boolean);
    const nextColumn = cloneJson(column);

    if (sourceColumn?.oid && previousColumn?.oid) {
      remappedColumnOids.set(sourceColumn.oid, previousColumn.oid);
      nextColumn.oid = previousColumn.oid;
    }
    if (previousColumn?.id) nextColumn.id = previousColumn.id;
    if (previousColumn?.vTag) nextColumn.vTag = previousColumn.vTag;

    return nextColumn;
  });

  for (const previousColumn of previousColumns) {
    const hasSourceEquivalent = getColumnLookupKeys(previousColumn).some((key) => sourceColumnKeys.has(key));
    if (hasSourceEquivalent) continue;

    if (previousColumn.oid) preservedTargetOnlyColumnOids.add(previousColumn.oid);
    retargetedTable.columns.push(cloneJson(previousColumn));
  }

  const sourceTransforms = (retargetedTable.tupleTransformations ?? []).map((transform) => {
    const nextTransform = cloneJson(transform);
    const args = nextTransform?.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return nextTransform;

    const currentColumnOid = String((args as Record<string, unknown>).column ?? '').trim();
    const remappedColumnOid = currentColumnOid ? remappedColumnOids.get(currentColumnOid) : '';
    if (remappedColumnOid) {
      (args as Record<string, unknown>).column = remappedColumnOid;
    }
    return nextTransform;
  });

  const effectiveSourceNames = new Set(getEffectiveTableColumnNames(retargetedTable).map(normalizeName));
  const preservedTargetTransforms = (previousTargetTable?.tupleTransformations ?? []).filter((transform) => {
    const args = (transform?.arguments ?? {}) as Record<string, unknown>;
    const transformType = String(transform?.type ?? '').trim();
    const referencedColumnOid = String(args.column ?? '').trim();
    const outputName = normalizeName(args.name ?? args.columnName);

    if (transformType === 'add-column') {
      return Boolean(outputName) && !effectiveSourceNames.has(outputName);
    }

    if (referencedColumnOid && preservedTargetOnlyColumnOids.has(referencedColumnOid)) {
      return true;
    }

    return false;
  }).map((transform) => cloneJson(transform));

  retargetedTable.tupleTransformations = [...sourceTransforms, ...preservedTargetTransforms];

  const sanitizedMergedTransforms = sanitizeTupleTransformations(
    retargetedTable,
    getTableName(sourceTable) || getTableName(previousTargetTable ?? {}) || '(unknown)'
  );
  retargetedTable.tupleTransformations = sanitizedMergedTransforms.tupleTransformations;

  return {
    table: retargetedTable,
    warnings: sanitizedMergedTransforms.warnings.map((warning) =>
      warning.replace('while transferring table', 'while preserving target-specific changes in table')
    ),
  };
};

const addNormalizedIfPresent = (set: Set<string>, value: unknown) => {
  const normalized = normalizeName(value);
  if (normalized) set.add(normalized);
};

const collectColumnReferenceNames = (
  columnLike: { name?: unknown; id?: unknown; displayName?: unknown }
) => {
  const names = new Set<string>();
  addNormalizedIfPresent(names, columnLike.name);
  addNormalizedIfPresent(names, columnLike.id);
  addNormalizedIfPresent(names, columnLike.displayName);
  return names;
};

const getTableReferenceColumns = (table: SmodelTable) => {
  const names = new Set<string>();
  const currentNamesByColumnOid = new Map<string, Set<string>>();

  for (const column of table.columns ?? []) {
    const aliases = collectColumnReferenceNames(column);
    for (const alias of aliases) names.add(alias);

    const columnOid = String(column.oid ?? '').trim();
    if (columnOid && aliases.size) {
      currentNamesByColumnOid.set(columnOid, new Set(aliases));
    }
  }

  for (const transform of table.tupleTransformations ?? []) {
    const transformType = String(transform?.type ?? '').trim();
    const args = (transform?.arguments ?? {}) as Record<string, unknown>;

    if (transformType === 'add-column') {
      for (const alias of collectColumnReferenceNames({
        name: args.name,
        id: args.id,
        displayName: args.displayName,
      })) {
        names.add(alias);
      }
      continue;
    }

    if (transformType === 'rename-column') {
      const columnOid = String(args.column ?? '').trim();
      const existingAliases = columnOid ? currentNamesByColumnOid.get(columnOid) : null;
      if (existingAliases) {
        for (const alias of existingAliases) names.add(alias);
      }
      for (const alias of collectColumnReferenceNames({
        name: args.name,
        id: args.id,
        displayName: args.displayName,
      })) {
        names.add(alias);
        if (existingAliases) existingAliases.add(alias);
      }
    }
  }

  return names;
};

const getTransformExpressionFormula = (transform: unknown) => {
  const expression = (transform as { arguments?: { expression?: unknown } } | null)?.arguments?.expression;
  if (typeof expression === 'object' && expression && 'expression' in expression) {
    return String((expression as Record<string, unknown>).expression ?? '');
  }
  return typeof expression === 'string' ? expression : '';
};

const collectBracketReferences = (
  formula: string,
  ignoredSpans: Array<{ start: number; end: number }> = []
) => {
  const references: Array<{ tableName: string; columnName: string }> = [];
  const qualifiedPattern = /\[([^\]]+)\]\s*\.\s*\[([^\]]+)\]/g;
  const matchedQualifiedSpans: Array<{ start: number; end: number }> = [];

  for (const match of formula.matchAll(qualifiedPattern)) {
    const [fullMatch, rawTableName, rawColumnName] = match;
    const start = match.index ?? -1;
    if (start >= 0) {
      matchedQualifiedSpans.push({ start, end: start + fullMatch.length });
    }
    references.push({
      tableName: String(rawTableName ?? '').trim(),
      columnName: String(rawColumnName ?? '').trim(),
    });
  }

  const singlePattern = /\[([^\]]+)\]/g;
  for (const match of formula.matchAll(singlePattern)) {
    const [fullMatch, rawColumnName] = match;
    const start = match.index ?? -1;
    const end = start >= 0 ? start + fullMatch.length : -1;
    const overlapsIgnored = start >= 0 && ignoredSpans.some((span) => start >= span.start && end <= span.end);
    if (overlapsIgnored) continue;
    const overlapsQualified = start >= 0 && matchedQualifiedSpans.some((span) => start >= span.start && end <= span.end);
    if (overlapsQualified) continue;
    references.push({
      tableName: '',
      columnName: String(rawColumnName ?? '').trim(),
    });
  }

  return references.filter((reference) => reference.columnName.length > 0);
};

const collectLookupReferences = (formula: string) => {
  const lookupPattern = /lookup\s*\(\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]\s*,\s*(?:\[([^\]]+)\]|\[([^\]]+)\]\s*\.\s*\[([^\]]+)\])\s*,\s*(?:\[([^\]]+)\]|\[([^\]]+)\]\s*\.\s*\[([^\]]+)\])\s*\)/ig;
  const lookups: Array<{
    span: { start: number; end: number };
    lookupTableName: string;
    returnColumnName: string;
    localReference: { tableName: string; columnName: string };
    lookupKeyReference: { tableName: string; columnName: string };
  }> = [];

  for (const match of formula.matchAll(lookupPattern)) {
    const fullMatch = match[0] ?? '';
    const start = match.index ?? -1;
    const localQualifiedTable = String(match[4] ?? '').trim();
    const localQualifiedColumn = String(match[5] ?? '').trim();
    const lookupQualifiedTable = String(match[7] ?? '').trim();
    const lookupQualifiedColumn = String(match[8] ?? '').trim();
    lookups.push({
      span: { start, end: start >= 0 ? start + fullMatch.length : -1 },
      lookupTableName: String(match[1] ?? '').trim(),
      returnColumnName: String(match[2] ?? '').trim(),
      localReference: {
        tableName: localQualifiedTable,
        columnName: localQualifiedColumn || String(match[3] ?? '').trim(),
      },
      lookupKeyReference: {
        tableName: lookupQualifiedTable,
        columnName: lookupQualifiedColumn || String(match[6] ?? '').trim(),
      },
    });
  }

  return lookups;
};

const pruneUnresolvedDerivedExpressions = (
  table: SmodelTable,
  model: SmodelDocument
): { table: SmodelTable; warnings: string[] } => {
  const tableByName = new Map<string, SmodelTable>();
  const referenceColumnsByTableName = new Map<string, Set<string>>();
  for (const dataset of model.datasets ?? []) {
    for (const candidateTable of dataset.schema?.tables ?? []) {
      const normalizedTableName = normalizeName(getTableName(candidateTable));
      tableByName.set(normalizedTableName, candidateTable);
      referenceColumnsByTableName.set(normalizedTableName, getTableReferenceColumns(candidateTable));
    }
  }

  const normalizedLocalTableName = normalizeName(getTableName(table));
  tableByName.set(normalizedLocalTableName, table);
  const localReferenceColumns = getTableReferenceColumns(table);
  referenceColumnsByTableName.set(normalizedLocalTableName, localReferenceColumns);
  const warnings: string[] = [];
  const keptTransforms: unknown[] = [];

  for (const transform of table.tupleTransformations ?? []) {
    const args = ((transform as { arguments?: unknown } | null)?.arguments ?? {}) as Record<string, unknown>;

    const formula = getTransformExpressionFormula(transform);
    if (!formula) {
      keptTransforms.push(transform);
      continue;
    }

    const missingReferences: string[] = [];
    const seenMissing = new Set<string>();
    const addMissingReference = (warning: string) => {
      if (!seenMissing.has(warning)) {
        seenMissing.add(warning);
        missingReferences.push(warning);
      }
    };

    const lookupReferences = collectLookupReferences(formula);
    for (const lookup of lookupReferences) {
      const normalizedLookupTableName = normalizeName(lookup.lookupTableName);
      const lookupTable = tableByName.get(normalizedLookupTableName);
      const lookupColumns = referenceColumnsByTableName.get(normalizedLookupTableName) ?? new Set<string>();

      if (!lookupTable) {
        addMissingReference(`lookup table "${lookup.lookupTableName}" is missing`);
      } else {
        if (!lookupColumns.has(normalizeName(lookup.returnColumnName))) {
          addMissingReference(`lookup column "${lookup.lookupTableName}.${lookup.returnColumnName}" is missing`);
        }
        if (!lookupColumns.has(normalizeName(lookup.lookupKeyReference.columnName))) {
          addMissingReference(`lookup key "${lookup.lookupTableName}.${lookup.lookupKeyReference.columnName}" is missing`);
        }
      }

      const localReferenceTableName = normalizeName(lookup.localReference.tableName);
      const localReferenceColumnName = normalizeName(lookup.localReference.columnName);
      if (localReferenceTableName) {
        const referencedTable = tableByName.get(localReferenceTableName);
        const referencedColumns = referenceColumnsByTableName.get(localReferenceTableName) ?? new Set<string>();
        const exists = localReferenceTableName === normalizedLocalTableName
          ? localReferenceColumns.has(localReferenceColumnName)
          : referencedColumns.has(localReferenceColumnName);
        if (!exists) {
          addMissingReference(
            referencedTable
              ? `referenced column "${lookup.localReference.tableName}.${lookup.localReference.columnName}" is missing`
              : `referenced table "${lookup.localReference.tableName}" is missing`
          );
        }
      } else if (!localReferenceColumns.has(localReferenceColumnName)) {
        addMissingReference(`local column "${getTableName(table)}.${lookup.localReference.columnName}" is missing`);
      }
    }

    for (const reference of collectBracketReferences(formula, lookupReferences.map((lookup) => lookup.span))) {
      const normalizedColumnName = normalizeName(reference.columnName);
      const normalizedTableName = normalizeName(reference.tableName);

      if (normalizedTableName) {
        const referencedTable = tableByName.get(normalizedTableName);
        const referencedColumns = referenceColumnsByTableName.get(normalizedTableName) ?? new Set<string>();
        const tableMatchesLocal = normalizedTableName === normalizedLocalTableName;
        const exists = tableMatchesLocal
          ? localReferenceColumns.has(normalizedColumnName)
          : referencedColumns.has(normalizedColumnName);
        if (exists) continue;

        const warning = referencedTable
          ? `referenced column "${reference.tableName}.${reference.columnName}" is missing`
          : `referenced table "${reference.tableName}" is missing`;
        addMissingReference(warning);
        continue;
      }

      if (!localReferenceColumns.has(normalizedColumnName)) {
        const warning = `local column "${getTableName(table)}.${reference.columnName}" is missing`;
        addMissingReference(warning);
      }
    }

    if (missingReferences.length) {
      const derivedColumnName = String(args.name ?? args.columnName ?? '(unknown)').trim();
      warnings.push(
        `Skipped derived column "${derivedColumnName}" while transferring table "${getTableName(table) || table.id || '(unknown)'}" because ${missingReferences.join(', ')}.`
      );
      continue;
    }

    keptTransforms.push(transform);
  }

  return {
    table: {
      ...table,
      tupleTransformations: keptTransforms as SmodelTable['tupleTransformations'],
    },
    warnings,
  };
};

const pruneExcludedAddedColumns = (
  table: SmodelTable,
  excludedAddedColumnNames: string[]
): { table: SmodelTable; warnings: string[] } => {
  const excludedNames = new Set(excludedAddedColumnNames.map(normalizeName).filter(Boolean));
  if (!excludedNames.size) {
    return { table, warnings: [] };
  }

  const warnings: string[] = [];
  const removedColumnOids = new Set<string>();
  const keptColumns: SmodelColumn[] = [];

  for (const column of table.columns ?? []) {
    const columnName = normalizeName(getColumnName(column));
    if (columnName && excludedNames.has(columnName)) {
      if (column.oid) removedColumnOids.add(column.oid);
      warnings.push(`Skipped source-added column "${getColumnName(column)}" because you unchecked it in the review step.`);
      continue;
    }
    keptColumns.push(column);
  }

  const keptTransforms = (table.tupleTransformations ?? []).filter((transform) => {
    const args = (transform?.arguments ?? {}) as Record<string, unknown>;
    const transformType = String(transform?.type ?? '').trim();
    const outputName = normalizeName(args.name ?? args.columnName);
    const referencedColumnOid = String(args.column ?? '').trim();

    if (outputName && excludedNames.has(outputName)) {
      warnings.push(`Skipped source-added derived column "${String(args.name ?? args.columnName ?? '')}" because you unchecked it in the review step.`);
      return false;
    }

    if (referencedColumnOid && removedColumnOids.has(referencedColumnOid)) {
      if (transformType) {
        warnings.push(`Skipped ${transformType} transformation tied to a source-added column that you unchecked in the review step.`);
      }
      return false;
    }

    return true;
  });

  return {
    table: {
      ...table,
      columns: keptColumns,
      tupleTransformations: keptTransforms,
    },
    warnings,
  };
};

const remapExistingTargetRelations = (
  relations: SmodelRelation[],
  previousTargetTable: SmodelTable,
  insertedTargetTable: SmodelTable,
  targetDataset: SmodelDataset
): { relations: SmodelRelation[]; warnings: string[] } => {
  const warnings: string[] = [];
  const previousColumnsByOid = new Map<string, SmodelColumn>();
  const insertedColumnsByName = new Map<string, SmodelColumn>();
  const droppedColumnOids = new Set(
    (insertedTargetTable.tupleTransformations ?? [])
      .filter((transform) => String(transform?.type ?? '').trim() === 'dont-import')
      .map((transform) => String(((transform?.arguments ?? {}) as Record<string, unknown>).column ?? '').trim())
      .filter(Boolean)
  );

  for (const column of previousTargetTable.columns ?? []) {
    if (column.oid) previousColumnsByOid.set(column.oid, column);
  }

  for (const column of insertedTargetTable.columns ?? []) {
    insertedColumnsByName.set(normalizeName(getColumnName(column)), column);
  }

  const remappedRelations: SmodelRelation[] = [];
  for (const relation of relations) {
    const remappedColumns = (relation.columns ?? []).map((column) => {
      if (column.table !== previousTargetTable.oid) return cloneJson(column);

      const previousColumn = column.column ? previousColumnsByOid.get(column.column) : null;
      const nextColumn = previousColumn
        ? insertedColumnsByName.get(normalizeName(getColumnName(previousColumn)))
        : null;

      if (column.column && !nextColumn?.oid) {
        warnings.push(`Skipped an existing target join reference for relation ${relation.oid ?? '(no oid)'} because column "${getColumnName(previousColumn ?? {})}" was not found in the replacement table.`);
        return null;
      }

      return {
        ...cloneJson(column),
        dataset: targetDataset.oid ?? column.dataset,
        table: insertedTargetTable.oid ?? column.table,
        column: nextColumn?.oid ?? column.column,
        isDropped: nextColumn?.oid && !droppedColumnOids.has(nextColumn.oid) ? null : column.isDropped,
      };
    }).filter((column): column is SmodelRelationRef => Boolean(column));

    if (remappedColumns.length !== (relation.columns ?? []).length) continue;

    remappedRelations.push({
      ...cloneJson(relation),
      columns: remappedColumns,
    });
  }

  return { relations: remappedRelations, warnings };
};

export function transferSmodelTable(
  sourceModelInput: SmodelDocument,
  targetModelInput: SmodelDocument,
  requestedTableName: string,
  selection: SmodelTransferSelection = {}
): SmodelTransferResult {
  const normalizedTableName = requestedTableName.trim();
  if (!normalizedTableName) {
    throw new Error('Enter a table name to transfer.');
  }

  const sourceModel = cloneJson(sourceModelInput);
  const targetModel = cloneJson(targetModelInput);
  const setupWarnings: string[] = [];
  if (!Array.isArray(sourceModel.datasets) || !Array.isArray(targetModel.datasets)) {
    throw new Error('Both uploaded files must contain Sisense model datasets.');
  }

  let sourceTableLocation = findTableByIndexes(
    sourceModel,
    selection.sourceDatasetIndex,
    selection.sourceTableIndex
  );
  if (!sourceTableLocation) {
    const sourceExactMatches = findTablesByExactName(sourceModel, normalizedTableName);
    if (sourceExactMatches.length > 1) {
      throw new Error(`Multiple source tables matched "${normalizedTableName}". Select the exact source table to transfer.`);
    }
    if (sourceExactMatches.length === 1) {
      sourceTableLocation = findTableByIndexes(
        sourceModel,
        sourceExactMatches[0].datasetIndex,
        sourceExactMatches[0].tableIndex
      );
    }
  }
  if (!sourceTableLocation) {
    throw new Error(`Exact source table "${normalizedTableName}" was not found. Use Find Exact Matches and choose the table to transfer.`);
  }

  let targetTableLocation = findTableByIndexes(
    targetModel,
    selection.targetDatasetIndex,
    selection.targetTableIndex
  );
  if (!targetTableLocation) {
    const targetExactMatches = findTablesByExactName(targetModel, normalizedTableName);
    if (targetExactMatches.length > 1) {
      throw new Error(`Multiple target tables matched "${normalizedTableName}". Select the exact target table to overwrite.`);
    }
    if (targetExactMatches.length === 1) {
      targetTableLocation = findTableByIndexes(
        targetModel,
        targetExactMatches[0].datasetIndex,
        targetExactMatches[0].tableIndex
      );
    }
  }
  let targetDatasetIndex = resolveTargetDatasetIndex(
    targetModel,
    sourceTableLocation,
    targetTableLocation,
    selection.targetDatasetIndex
  );
  if (targetDatasetIndex < 0) {
    const createdTargetDataset = createTargetDatasetForNewTable(sourceTableLocation.dataset);
    targetModel.datasets.push(createdTargetDataset);
    targetDatasetIndex = targetModel.datasets.length - 1;
    setupWarnings.push(
      `No matching target table or dataset was found for "${normalizedTableName}". A new dataset block was created in the target cube to hold the transferred table.`
    );
  }

  const targetDataset = targetModel.datasets[targetDatasetIndex];
  if (!targetDataset.schema) {
    targetDataset.schema = { tables: [] };
  } else if (!Array.isArray(targetDataset.schema.tables)) {
    targetDataset.schema.tables = [];
  }

  const previousTargetTable = targetTableLocation ? cloneJson(targetTableLocation.table) : null;
  const previousTargetRelations = (targetModel.relations ?? []).filter((relation) =>
    (relation.columns ?? []).some((column) => column.table === previousTargetTable?.oid)
  );
  const preparedTable = prepareTransferredTable(
    cloneJson(sourceTableLocation.table),
    normalizedTableName
  );
  const retargetedTable = retargetTransferredTable(
    preparedTable.table,
    targetDataset,
    previousTargetTable
  );
  const sourceTableClone = retargetedTable.table;
  const excludedAddedColumnNames = selection.excludedAddedColumnNames ?? [];

  if (targetTableLocation) {
    targetDataset.schema!.tables![targetTableLocation.tableIndex] = sourceTableClone;
  } else {
    targetDataset.schema!.tables!.push(sourceTableClone);
  }

  const insertedTargetTable =
    targetDataset.schema!.tables![targetTableLocation ? targetTableLocation.tableIndex : targetDataset.schema!.tables!.length - 1];

  const prunedExcludedColumns = pruneExcludedAddedColumns(insertedTargetTable, excludedAddedColumnNames);
  targetDataset.schema!.tables![targetTableLocation ? targetTableLocation.tableIndex : targetDataset.schema!.tables!.length - 1] =
    prunedExcludedColumns.table;
  const excludedAdjustedTargetTable =
    targetDataset.schema!.tables![targetTableLocation ? targetTableLocation.tableIndex : targetDataset.schema!.tables!.length - 1];

  const prunedLookupTransforms = pruneUnresolvedDerivedExpressions(excludedAdjustedTargetTable, targetModel);
  targetDataset.schema!.tables![targetTableLocation ? targetTableLocation.tableIndex : targetDataset.schema!.tables!.length - 1] =
    prunedLookupTransforms.table;
  const finalizedTargetTable =
    targetDataset.schema!.tables![targetTableLocation ? targetTableLocation.tableIndex : targetDataset.schema!.tables!.length - 1];

  validateTableSchema(finalizedTargetTable);

  const sourceTableOid = sourceTableLocation.table.oid ?? '';
  const relatedSourceRelations = (sourceModel.relations ?? []).filter((relation) =>
    (relation.columns ?? []).some((column) => column.table === sourceTableOid)
  );

  const warnings: string[] = [...setupWarnings, ...preparedTable.warnings, ...retargetedTable.warnings, ...prunedExcludedColumns.warnings, ...prunedLookupTransforms.warnings];
  const sourceBinaryRelationCount = relatedSourceRelations.filter(isBinaryRelation).length;
  const sourceNonBinaryRelationCount = relatedSourceRelations.length - sourceBinaryRelationCount;
  if (relatedSourceRelations.length) {
    warnings.push(
      `Source joins were reviewed but not copied. This workspace transfers only the exact selected table block into the target model.`
    );
  }
  if (sourceNonBinaryRelationCount > 0) {
    warnings.push(
      `Detected ${sourceNonBinaryRelationCount} malformed source relation${sourceNonBinaryRelationCount === 1 ? '' : 's'} for table "${getTableName(sourceTableLocation.table) || normalizedTableName}" that do not have exactly 2 endpoints.`
    );
  }

  const { relations: remappedExistingTargetRelations, warnings: existingTargetRelationWarnings } =
    previousTargetTable
      ? remapExistingTargetRelations(previousTargetRelations, previousTargetTable, finalizedTargetTable, targetDataset)
      : { relations: [], warnings: [] };
  warnings.push(...existingTargetRelationWarnings);

  const baseTargetRelations = (targetModel.relations ?? []).filter(
    (relation) => !(relation.columns ?? []).some((column) => column.table === previousTargetTable?.oid)
  );
  const existingRelationSignatures = new Set(baseTargetRelations.map(buildRelationSignature));
  const preservedRelations: SmodelRelation[] = [];
  for (const relation of remappedExistingTargetRelations) {
    const signature = buildRelationSignature(relation);
    if (existingRelationSignatures.has(signature)) continue;
    existingRelationSignatures.add(signature);
    preservedRelations.push(relation);
  }

  const appendedRelations: SmodelRelation[] = [];

  targetModel.relations = [...baseTargetRelations, ...preservedRelations, ...appendedRelations];
  const updatedTargetRelations = (targetModel.relations ?? []).filter((relation) =>
    (relation.columns ?? []).some((column) => column.table === finalizedTargetTable?.oid)
  );

  const sourceRelationPreviews = buildRelationPreviews(relatedSourceRelations, sourceModel);
  const previousTargetRelationPreviews = buildRelationPreviews(previousTargetRelations, targetModelInput);
  const copiedRelationPreviews = buildRelationPreviews(appendedRelations, targetModel);
  const columnDiff = buildColumnDiff(previousTargetTable, finalizedTargetTable);
  const sourceColumnCount = getEffectiveTableColumnNames(sourceTableLocation.table).length;
  const previousTargetColumnCount = previousTargetTable ? getEffectiveTableColumnNames(previousTargetTable).length : 0;
  const updatedTargetColumnCount = getEffectiveTableColumnNames(finalizedTargetTable).length;

  return {
    transformedModel: targetModel,
    preview: {
      tableName: getTableName(sourceTableLocation.table) || normalizedTableName,
      sourceModelTitle: String(sourceModel.title ?? ''),
      targetModelTitle: String(targetModelInput.title ?? ''),
      sourceDatasetName: String(sourceTableLocation.dataset.name ?? sourceTableLocation.dataset.oid ?? ''),
      targetDatasetName: String(targetDataset.name ?? targetDataset.oid ?? ''),
      targetTableFound: Boolean(targetTableLocation),
      sourceColumnCount,
      previousTargetColumnCount,
      updatedTargetColumnCount,
      columnDiff,
      sourceTableJson: prettyJson(sourceTableLocation.table),
      previousTargetTableJson: previousTargetTable ? prettyJson(previousTargetTable) : '',
      updatedTargetTableJson: prettyJson(finalizedTargetTable),
      previousTargetRelationCount: previousTargetRelations.length,
      updatedTargetRelationCount: updatedTargetRelations.length,
      copiedRelationCount: appendedRelations.length,
      sourceRelations: sourceRelationPreviews,
      previousTargetRelations: previousTargetRelationPreviews,
      copiedRelations: copiedRelationPreviews,
      warnings,
    },
  };
}
