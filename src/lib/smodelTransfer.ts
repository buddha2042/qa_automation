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

  const sourceTableClone = cloneJson(sourceTableLocation.table);
  const previousTargetTable = targetTableLocation ? cloneJson(targetTableLocation.table) : null;

  if (targetTableLocation) {
    targetDataset.schema!.tables![targetTableLocation.tableIndex] = sourceTableClone;
  } else {
    targetDataset.schema!.tables!.push(sourceTableClone);
  }

  const insertedTargetTable =
    targetDataset.schema!.tables![targetTableLocation ? targetTableLocation.tableIndex : targetDataset.schema!.tables!.length - 1];

  const previousTargetRelations = (targetModel.relations ?? []).filter((relation) =>
    (relation.columns ?? []).some((column) => column.table === previousTargetTable?.oid)
  );

  targetModel.relations = (targetModel.relations ?? []).filter(
    (relation) => !(relation.columns ?? []).some((column) => column.table === previousTargetTable?.oid)
  );

  const sourceTableOid = sourceTableLocation.table.oid ?? '';
  const relatedSourceRelations = (sourceModel.relations ?? []).filter((relation) =>
    (relation.columns ?? []).some((column) => column.table === sourceTableOid)
  );

  const warnings: string[] = [];
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

  targetModel.relations = [...(targetModel.relations ?? []), ...remappedRelations];

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
      updatedTargetRelationCount: remappedRelations.length,
      copiedRelationCount: remappedRelations.length,
      warnings,
    },
  };
}
