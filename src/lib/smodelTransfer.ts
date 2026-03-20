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
  schemaName?: string;
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

export interface SmodelDocument {
  title?: string;
  datasets?: SmodelDataset[];
  relations?: SmodelRelation[];
  [key: string]: unknown;
}

export interface SmodelTransferPreview {
  tableName: string;
  sourceDatasetName: string;
  targetDatasetName: string;
  targetTableFound: boolean;
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

export interface SmodelTransferCandidatesResult {
  sourceMatches: SmodelTableCandidate[];
  targetMatches: SmodelTableCandidate[];
}

export interface SmodelTransferSelection {
  sourceDatasetIndex?: number;
  sourceTableIndex?: number;
  targetDatasetIndex?: number;
  targetTableIndex?: number;
}

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

const toTableCandidate = (
  dataset: SmodelDataset,
  datasetIndex: number,
  table: SmodelTable,
  tableIndex: number
): SmodelTableCandidate => ({
  datasetIndex,
  tableIndex,
  datasetName: String(dataset.name ?? dataset.oid ?? ''),
  schemaName: String(table.schemaName ?? dataset.schemaName ?? ''),
  tableName: getTableName(table),
  tableId: String(table.id ?? ''),
  tableOid: String(table.oid ?? ''),
  tableType: String(table.type ?? ''),
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
  return {
    sourceMatches: findTablesByExactName(sourceModel, requestedTableName),
    targetMatches: findTablesByExactName(targetModel, requestedTableName),
  };
}

const resolveTargetDatasetIndex = (
  model: SmodelDocument,
  sourceTableLocation: ResolvedTableLocation,
  targetTableLocation: ResolvedTableLocation | null
) => {
  if (targetTableLocation) return targetTableLocation.datasetIndex;

  const sourceSchemaName = normalizeName(sourceTableLocation.table.schemaName ?? sourceTableLocation.dataset.schemaName);
  const datasets = Array.isArray(model.datasets) ? model.datasets : [];
  const schemaMatches = datasets.filter((dataset) => normalizeName(dataset.schemaName) === sourceSchemaName);
  if (schemaMatches.length === 1) {
    return datasets.indexOf(schemaMatches[0]);
  }
  return -1;
};

const buildTargetReferenceLookups = (model: SmodelDocument) => {
  const tableByOid = new Map<string, { dataset: SmodelDataset; table: SmodelTable }>();
  const tableByName = new Map<string, { dataset: SmodelDataset; table: SmodelTable }>();
  const columnByTableAndName = new Map<string, SmodelColumn>();

  for (const dataset of model.datasets ?? []) {
    for (const table of dataset.schema?.tables ?? []) {
      if (table.oid) tableByOid.set(table.oid, { dataset, table });
      tableByName.set(`${normalizeName(dataset.schemaName)}|${normalizeName(getTableName(table))}`, { dataset, table });
      for (const column of table.columns ?? []) {
        columnByTableAndName.set(
          `${normalizeName(dataset.schemaName)}|${normalizeName(getTableName(table))}|${normalizeName(getColumnName(column))}`,
          column
        );
      }
    }
  }

  return { tableByOid, tableByName, columnByTableAndName };
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
        warnings.push(`Skipped add-column transformation "${String(args.name ?? args.columnName ?? '')}" because that name already exists in table "${tableName}".`);
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

    if (transformType === 'add-column') {
      const requestedName = String(args.name ?? args.columnName ?? '').trim();
      if (requestedName) names.push(requestedName);
    }
  }

  return names.filter((name) => name.trim().length > 0);
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
) => {
  const retargetedTable = cloneJson(sourceTable);
  const sourceColumnsByName = new Map(
    (sourceTable.columns ?? []).map((column) => [normalizeName(getColumnName(column)), column] as const)
  );
  const previousColumnsByName = new Map(
    (previousTargetTable?.columns ?? []).map((column) => [normalizeName(getColumnName(column)), column] as const)
  );
  const remappedColumnOids = new Map<string, string>();

  retargetedTable.schemaName = String(previousTargetTable?.schemaName ?? targetDataset.schemaName ?? retargetedTable.schemaName ?? '');
  if (previousTargetTable?.oid) retargetedTable.oid = previousTargetTable.oid;
  if (previousTargetTable?.id) retargetedTable.id = previousTargetTable.id;
  if (previousTargetTable?.vTag) retargetedTable.vTag = previousTargetTable.vTag;
  if (previousTargetTable && 'role' in previousTargetTable) retargetedTable.role = previousTargetTable.role;
  if (previousTargetTable && 'isRoleBySystem' in previousTargetTable) retargetedTable.isRoleBySystem = previousTargetTable.isRoleBySystem;

  retargetedTable.columns = (retargetedTable.columns ?? []).map((column) => {
    const columnName = normalizeName(getColumnName(column));
    const sourceColumn = sourceColumnsByName.get(columnName);
    const previousColumn = previousColumnsByName.get(columnName);
    const nextColumn = cloneJson(column);

    if (sourceColumn?.oid && previousColumn?.oid) {
      remappedColumnOids.set(sourceColumn.oid, previousColumn.oid);
      nextColumn.oid = previousColumn.oid;
    }
    if (previousColumn?.id) nextColumn.id = previousColumn.id;
    if (previousColumn?.vTag) nextColumn.vTag = previousColumn.vTag;

    return nextColumn;
  });

  retargetedTable.tupleTransformations = (retargetedTable.tupleTransformations ?? []).map((transform) => {
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

  return retargetedTable;
};

const getTableEffectiveColumns = (table: SmodelTable) => {
  const names = new Set<string>();
  for (const name of getEffectiveTableColumnNames(table)) {
    names.add(normalizeName(name));
  }
  return names;
};

const validateLookupExpressions = (
  table: SmodelTable,
  model: SmodelDocument
) => {
  const tableByName = new Map<string, SmodelTable>();
  for (const dataset of model.datasets ?? []) {
    for (const candidateTable of dataset.schema?.tables ?? []) {
      tableByName.set(normalizeName(getTableName(candidateTable)), candidateTable);
    }
  }

  const localColumns = getTableEffectiveColumns(table);
  const missingReferences = new Set<string>();

  for (const transform of table.tupleTransformations ?? []) {
    const expression = transform?.arguments?.expression;
    const formula = typeof expression === 'object' && expression && 'expression' in expression
      ? String((expression as Record<string, unknown>).expression ?? '')
      : '';
    if (!formula) continue;

    const lookupMatch = formula.match(
      /lookup\s*\(\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]\s*\)/i
    );
    if (!lookupMatch) continue;

    const [, lookupTableName, returnColumnName, localColumnName, lookupKeyName] = lookupMatch;
    const lookupTable = tableByName.get(normalizeName(lookupTableName));
    const lookupColumns = lookupTable ? getTableEffectiveColumns(lookupTable) : new Set<string>();

    if (!lookupTable) {
      missingReferences.add(`Lookup table "${lookupTableName}" is missing.`);
      continue;
    }
    if (!lookupColumns.has(normalizeName(returnColumnName))) {
      missingReferences.add(`Lookup column "${lookupTableName}.${returnColumnName}" is missing.`);
    }
    if (!lookupColumns.has(normalizeName(lookupKeyName))) {
      missingReferences.add(`Lookup key "${lookupTableName}.${lookupKeyName}" is missing.`);
    }
    if (!localColumns.has(normalizeName(localColumnName))) {
      missingReferences.add(`Local column "${getTableName(table)}.${localColumnName}" is missing.`);
    }
  }

  if (missingReferences.size) {
    throw new Error(
      `Transferred table "${getTableName(table) || table.id || '(unknown)'}" has unresolved lookup references in the target model: ${[...missingReferences].slice(0, 8).join(' ')}`
    );
  }
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

const buildRelationRemapContext = (
  sourceModel: SmodelDocument,
  targetModel: SmodelDocument,
  sourceTableLocation: ResolvedTableLocation,
  insertedTargetTable: SmodelTable,
  targetDataset: SmodelDataset
) => {
  const sourceTableByOid = new Map<string, { dataset: SmodelDataset; table: SmodelTable }>();
  for (const dataset of sourceModel.datasets ?? []) {
    for (const table of dataset.schema?.tables ?? []) {
      if (table.oid) sourceTableByOid.set(table.oid, { dataset, table });
    }
  }

  const targetLookups = buildTargetReferenceLookups(targetModel);
  const transferredColumnMap = new Map<string, string>();
  for (const column of sourceTableLocation.table.columns ?? []) {
    if (column.oid) {
      const transferredColumn = (insertedTargetTable.columns ?? []).find(
        (candidate) => normalizeName(getColumnName(candidate)) === normalizeName(getColumnName(column))
      );
      if (transferredColumn?.oid) {
        transferredColumnMap.set(column.oid, transferredColumn.oid);
      }
    }
  }

  return {
    sourceTableByOid,
    targetLookups,
    transferredColumnMap,
    transferredTableOid: insertedTargetTable.oid ?? '',
    targetDatasetOid: targetDataset.oid ?? '',
  };
};

const remapRelationRef = (
  ref: SmodelRelationRef,
  context: ReturnType<typeof buildRelationRemapContext>,
  sourceTableOid: string
): SmodelRelationRef | null => {
  const sourceTableEntry = ref.table ? context.sourceTableByOid.get(ref.table) : null;
  if (!sourceTableEntry) return null;

  const sourceSchemaName = normalizeName(sourceTableEntry.dataset.schemaName);
  const sourceTableName = normalizeName(getTableName(sourceTableEntry.table));

  if (ref.table === sourceTableOid) {
    return {
      ...ref,
      dataset: context.targetDatasetOid,
      table: context.transferredTableOid,
      column: ref.column ? context.transferredColumnMap.get(ref.column) ?? ref.column : ref.column,
    };
  }

  const targetTableEntry = context.targetLookups.tableByName.get(`${sourceSchemaName}|${sourceTableName}`);
  if (!targetTableEntry?.table.oid || !targetTableEntry.dataset.oid) return null;

  let targetColumnOid = ref.column;
  const sourceColumn = (sourceTableEntry.table.columns ?? []).find((column) => column.oid === ref.column);
  const sourceColumnName = sourceColumn ? normalizeName(getColumnName(sourceColumn)) : '';
  if (sourceColumnName) {
    targetColumnOid =
      context.targetLookups.columnByTableAndName.get(
        `${sourceSchemaName}|${sourceTableName}|${sourceColumnName}`
      )?.oid ?? targetColumnOid;
  }

  if (ref.column && !targetColumnOid) return null;

  return {
    ...ref,
    dataset: targetTableEntry.dataset.oid,
    table: targetTableEntry.table.oid,
    column: targetColumnOid,
  };
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
  const targetDatasetIndex = resolveTargetDatasetIndex(targetModel, sourceTableLocation, targetTableLocation);
  if (targetDatasetIndex < 0) {
    throw new Error(
      `Could not find a matching target dataset for table "${normalizedTableName}". Add the table to the target model first or align the schema name.`
    );
  }

  const targetDataset = targetModel.datasets[targetDatasetIndex];
  if (!targetDataset.schema) {
    targetDataset.schema = { tables: [] };
  } else if (!Array.isArray(targetDataset.schema.tables)) {
    targetDataset.schema.tables = [];
  }

  const previousTargetTable = targetTableLocation ? cloneJson(targetTableLocation.table) : null;
  const preparedTable = prepareTransferredTable(
    cloneJson(sourceTableLocation.table),
    normalizedTableName
  );
  const sourceTableClone = retargetTransferredTable(
    preparedTable.table,
    targetDataset,
    previousTargetTable
  );

  if (targetTableLocation) {
    targetDataset.schema!.tables![targetTableLocation.tableIndex] = sourceTableClone;
  } else {
    targetDataset.schema!.tables!.push(sourceTableClone);
  }

  const insertedTargetTable =
    targetDataset.schema!.tables![targetTableLocation ? targetTableLocation.tableIndex : targetDataset.schema!.tables!.length - 1];

  validateTableSchema(insertedTargetTable);
  validateLookupExpressions(insertedTargetTable, targetModel);

  const previousTargetRelations = (targetModel.relations ?? []).filter((relation) =>
    (relation.columns ?? []).some((column) => column.table === previousTargetTable?.oid)
  );

  const sourceTableOid = sourceTableLocation.table.oid ?? '';
  const relatedSourceRelations = (sourceModel.relations ?? []).filter((relation) =>
    (relation.columns ?? []).some((column) => column.table === sourceTableOid)
  );

  const warnings: string[] = [...preparedTable.warnings];
  const relationContext = buildRelationRemapContext(
    sourceModel,
    targetModel,
    sourceTableLocation,
    insertedTargetTable,
    targetDataset
  );

  const remappedRelations: SmodelRelation[] = [];
  for (const relation of relatedSourceRelations) {
    const remappedColumns = (relation.columns ?? [])
      .map((column) => remapRelationRef(column, relationContext, sourceTableOid))
      .filter((column): column is SmodelRelationRef => Boolean(column));

    if (remappedColumns.length !== (relation.columns ?? []).length) {
      warnings.push(`Skipped one or more join references for relation ${relation.oid ?? '(no oid)'} because a matching target table or column was not found.`);
      continue;
    }

    remappedRelations.push({
      ...cloneJson(relation),
      columns: remappedColumns,
    });
  }

  const { relations: remappedExistingTargetRelations, warnings: existingTargetRelationWarnings } =
    previousTargetTable
      ? remapExistingTargetRelations(previousTargetRelations, previousTargetTable, insertedTargetTable, targetDataset)
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
  for (const relation of remappedRelations) {
    const signature = buildRelationSignature(relation);
    if (existingRelationSignatures.has(signature)) continue;
    existingRelationSignatures.add(signature);
    appendedRelations.push(relation);
  }

  targetModel.relations = [...baseTargetRelations, ...preservedRelations, ...appendedRelations];
  const updatedTargetRelations = (targetModel.relations ?? []).filter((relation) =>
    (relation.columns ?? []).some((column) => column.table === insertedTargetTable?.oid)
  );

  const sourceRelationPreviews = buildRelationPreviews(relatedSourceRelations, sourceModel);
  const previousTargetRelationPreviews = buildRelationPreviews(previousTargetRelations, targetModelInput);
  const copiedRelationPreviews = buildRelationPreviews(appendedRelations, targetModel);

  return {
    transformedModel: targetModel,
    preview: {
      tableName: getTableName(sourceTableLocation.table) || normalizedTableName,
      sourceDatasetName: String(sourceTableLocation.dataset.name ?? sourceTableLocation.dataset.oid ?? ''),
      targetDatasetName: String(targetDataset.name ?? targetDataset.oid ?? ''),
      targetTableFound: Boolean(targetTableLocation),
      sourceTableJson: prettyJson(sourceTableLocation.table),
      previousTargetTableJson: previousTargetTable ? prettyJson(previousTargetTable) : '',
      updatedTargetTableJson: prettyJson(insertedTargetTable),
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
