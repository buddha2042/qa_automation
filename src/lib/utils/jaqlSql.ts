const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const quoteSqlValue = (value: unknown): string => {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};

const dimToSqlColumn = (dim: string): string => {
  const cleaned = dim.replace(/^\[/, '').replace(/\]$/, '');
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx === -1) return cleaned;
  const table = cleaned.slice(0, dotIdx);
  const column = cleaned.slice(dotIdx + 1);
  return `${table}."${column}"`;
};

const extractJaqlExpr = (jaqlLike: Record<string, unknown>): string => {
  const formula = typeof jaqlLike.formula === 'string' ? jaqlLike.formula.trim() : '';
  if (formula) return formula;

  const dim = typeof jaqlLike.dim === 'string' ? jaqlLike.dim.trim() : '';
  if (dim) return dimToSqlColumn(dim);

  const title = typeof jaqlLike.title === 'string' ? jaqlLike.title.trim() : '';
  if (title) return title;

  const column = typeof jaqlLike.column === 'string' ? jaqlLike.column.trim() : '';
  if (column) return column;

  return 'UNKNOWN_EXPR';
};

const extractWhereCondition = (jaqlLike: Record<string, unknown>): string | null => {
  const filter = asRecord(jaqlLike.filter);
  if (!filter || filter.all === true) return null;

  const left = extractJaqlExpr(jaqlLike);
  const members = Array.isArray(filter.members) ? filter.members : null;
  if (members && members.length > 0) {
    return `${left} IN (${members.map((m) => quoteSqlValue(m)).join(', ')})`;
  }

  if (filter.equals !== undefined) {
    return `${left} = ${quoteSqlValue(filter.equals)}`;
  }

  if (filter.from !== undefined || filter.to !== undefined) {
    const from = filter.from !== undefined ? `${left} >= ${quoteSqlValue(filter.from)}` : null;
    const to = filter.to !== undefined ? `${left} <= ${quoteSqlValue(filter.to)}` : null;
    return [from, to].filter(Boolean).join(' AND ');
  }

  return null;
};

export const isJaqlQueryShape = (value: unknown): boolean => {
  const query = asRecord(value);
  return !!query && (Array.isArray(query.metadata) || !!asRecord(query.datasource));
};

export const toSqlLikeQuery = (value: unknown): string | null => {
  const query = asRecord(value);
  if (!query) return null;

  const datasource = asRecord(query.datasource);
  const sourceFullname =
    typeof datasource?.fullname === 'string' && datasource.fullname.trim()
      ? datasource.fullname.trim()
      : 'UNKNOWN_DATASOURCE';

  const metadata = Array.isArray(query.metadata) ? query.metadata : [];
  const selectExprs: string[] = [];
  const whereExprs: string[] = [];

  for (const item of metadata) {
    const itemObj = asRecord(item);
    const jaql = asRecord(itemObj?.jaql);
    if (!jaql) continue;

    const panel = typeof itemObj?.panel === 'string' ? itemObj.panel : '';
    if (panel === 'scope' || panel === 'filters') {
      const condition = extractWhereCondition(jaql);
      if (condition) whereExprs.push(condition);
      continue;
    }

    if (itemObj?.disabled === true) continue;
    selectExprs.push(extractJaqlExpr(jaql));
  }

  const sql = [
    `SELECT`,
    `  ${(selectExprs.length > 0 ? selectExprs : ['*']).join(',\n  ')}`,
    `FROM "${sourceFullname}"`,
    whereExprs.length > 0 ? `WHERE\n  ${whereExprs.join('\n  AND ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${sql};`;
};
