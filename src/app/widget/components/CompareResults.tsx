'use client';

import { type ReactNode, type RefObject } from 'react';
import { Search, CheckCircle2, XCircle, Download, Filter, Copy } from 'lucide-react';
import {
  type ComparisonItem,
  type Environment,
  type JsonValue,
  type WidgetPanel,
  type WidgetPanelItem,
  type WidgetPayloadTyped,
} from '@/app/widget/types';

interface CompareResultsProps {
  hasCompared: boolean;
  widgetPreviewRef: RefObject<HTMLElement | null>;
  canExportPreviewCsv: boolean;
  onExportPreviewCompareCsv: () => void;
  previewRows: Record<Environment, string[][]>;
  previewDiffCount: number;
  regularData: WidgetPayloadTyped | null;
  refactorData: WidgetPayloadTyped | null;
  loadingPreviewRegular: boolean;
  loadingPreviewRefactor: boolean;
  comparisonReport: ComparisonItem[];
  filteredReport: ComparisonItem[];
  showDiffOnly: boolean;
  onToggleDiffOnly: () => void;
  onExportCSV: () => void;
}

export default function CompareResults({
  hasCompared,
  widgetPreviewRef,
  canExportPreviewCsv,
  onExportPreviewCompareCsv,
  previewRows,
  previewDiffCount,
  regularData,
  refactorData,
  loadingPreviewRegular,
  loadingPreviewRefactor,
  comparisonReport,
  filteredReport,
  showDiffOnly,
  onToggleDiffOnly,
  onExportCSV,
}: CompareResultsProps) {
  if (!hasCompared) return null;

  return (
    <>
      <section
        ref={widgetPreviewRef}
        className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm h-[70vh] flex flex-col"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 shrink-0">
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-700">Widget Preview</h2>
            <p className="text-xs text-slate-500">
              Preview rows are generated only after full audit comparison.
            </p>
          </div>
          <button
            onClick={onExportPreviewCompareCsv}
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

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PreviewSideCard label="Legacy Preview" tone="rose">
              {!regularData ? (
                <div className="h-[280px] flex items-center justify-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
                  Fetch legacy payload first.
                </div>
              ) : (
                <WidgetNaturalPreview
                  payload={regularData}
                  queryRows={previewRows.regular}
                  queryLoading={loadingPreviewRegular}
                  peerRows={previewRows.refactor}
                />
              )}
            </PreviewSideCard>

            <PreviewSideCard label="Refactor Preview" tone="emerald">
              {!refactorData ? (
                <div className="h-[280px] flex items-center justify-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
                  Fetch refactor payload first.
                </div>
              ) : (
                <WidgetNaturalPreview
                  payload={refactorData}
                  queryRows={previewRows.refactor}
                  queryLoading={loadingPreviewRefactor}
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
        </div>
      </section>

      <div className="space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-700">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard
            label="Total Audit Points"
            val={comparisonReport.length}
            icon={<Search className="text-slate-300" />}
          />
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
              onClick={onToggleDiffOnly}
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
              onClick={onExportCSV}
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
    </>
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

function rowKey(row: string[]): string {
  return JSON.stringify(row.map((cell) => cell ?? ''));
}

function buildRowCountMap(rows: string[][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function getRowMismatchFlags(rows: string[][], peerRows: string[][]): boolean[] {
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
