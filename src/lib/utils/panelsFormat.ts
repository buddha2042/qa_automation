const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const cleanDim = (dim: string): string => dim.replace(/^\[/, '').replace(/\]$/, '');

const summarizeFilter = (filterLike: unknown): string | null => {
  const filter = asRecord(filterLike);
  if (!filter || filter.all === true) return null;

  const members = Array.isArray(filter.members) ? filter.members : null;
  if (members && members.length > 0) {
    const shown = members.slice(0, 5).map((m) => String(m)).join(', ');
    const rest = members.length > 5 ? ` ...(+${members.length - 5})` : '';
    return `IN (${shown}${rest})`;
  }

  if (filter.equals !== undefined) {
    return `= ${String(filter.equals)}`;
  }

  if (filter.from !== undefined || filter.to !== undefined) {
    const from = filter.from !== undefined ? `>= ${String(filter.from)}` : null;
    const to = filter.to !== undefined ? `<= ${String(filter.to)}` : null;
    return [from, to].filter(Boolean).join(' AND ');
  }

  return 'custom';
};

const itemSummary = (itemLike: unknown): string => {
  const item = asRecord(itemLike);
  if (!item) return 'Unknown item';

  const jaql = asRecord(item.jaql);
  if (!jaql) return 'No JAQL';

  const formula = typeof jaql.formula === 'string' ? jaql.formula.trim() : '';
  const dim = typeof jaql.dim === 'string' ? cleanDim(jaql.dim) : '';
  const title = typeof jaql.title === 'string' ? jaql.title.trim() : '';
  const column = typeof jaql.column === 'string' ? jaql.column.trim() : '';
  const agg = typeof jaql.agg === 'string' ? jaql.agg.trim() : '';
  const disabled = item.disabled === true;

  const base = formula || title || column || dim || 'Unknown';
  const measureExpr = agg && !formula ? `${agg.toUpperCase()}(${base})` : base;
  const filter = summarizeFilter(jaql.filter);
  const filterPart = filter ? ` [filter: ${filter}]` : '';
  const disabledPart = disabled ? ' [disabled]' : '';

  return `${measureExpr}${filterPart}${disabledPart}`;
};

export const isPanelsShape = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every((panel) => {
    const panelObj = asRecord(panel);
    return !!panelObj && (typeof panelObj.name === 'string' || Array.isArray(panelObj.items));
  });

export const toPanelsPrettyText = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;

  const lines: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const panelObj = asRecord(value[i]);
    if (!panelObj) continue;

    const panelName =
      typeof panelObj.name === 'string' && panelObj.name.trim()
        ? panelObj.name.trim()
        : `panel_${i + 1}`;

    lines.push(`${panelName}:`);
    const items = Array.isArray(panelObj.items) ? panelObj.items : [];
    if (items.length === 0) {
      lines.push('  (no items)');
      continue;
    }

    for (let j = 0; j < items.length; j += 1) {
      lines.push(`  ${j + 1}. ${itemSummary(items[j])}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
};
