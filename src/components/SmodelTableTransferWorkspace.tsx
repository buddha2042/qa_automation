'use client';

import { useState } from 'react';
import { AlertTriangle, Database, Upload } from 'lucide-react';

interface SmodelTransferPreview {
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

interface SmodelTransferRelationPreview {
  relationOid: string;
  relationType: string;
  summary: string;
  json: string;
}

interface SmodelTableCandidate {
  datasetIndex: number;
  tableIndex: number;
  datasetName: string;
  schemaName: string;
  tableName: string;
  tableId: string;
  tableOid: string;
  tableType: string;
}

export default function SmodelTableTransferWorkspace({
  variant = 'standalone',
}: {
  variant?: 'standalone' | 'embedded';
}) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [tableName, setTableName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [preview, setPreview] = useState<SmodelTransferPreview | null>(null);
  const [sourceMatches, setSourceMatches] = useState<SmodelTableCandidate[]>([]);
  const [targetMatches, setTargetMatches] = useState<SmodelTableCandidate[]>([]);
  const [selectedSourceKey, setSelectedSourceKey] = useState('');
  const [selectedTargetKey, setSelectedTargetKey] = useState('');

  const canInspect = Boolean(sourceFile && targetFile && tableName.trim());
  const canRun = Boolean(sourceFile && targetFile && tableName.trim() && selectedSourceKey);
  const isEmbedded = variant === 'embedded';

  const resetTransferState = () => {
    setError('');
    setSuccess('');
    setPreview(null);
    setSourceMatches([]);
    setTargetMatches([]);
    setSelectedSourceKey('');
    setSelectedTargetKey('');
  };

  const parseSelectionKey = (value: string) => {
    const [datasetIndexRaw, tableIndexRaw] = value.split(':');
    const datasetIndex = Number(datasetIndexRaw);
    const tableIndex = Number(tableIndexRaw);
    if (!Number.isInteger(datasetIndex) || !Number.isInteger(tableIndex)) return null;
    return { datasetIndex, tableIndex };
  };

  const handleInspect = async () => {
    if (!sourceFile || !targetFile || !tableName.trim()) return;

    setLoading(true);
    setError('');
    setSuccess('');
    setPreview(null);

    try {
      const formData = new FormData();
      formData.append('left', sourceFile);
      formData.append('right', targetFile);
      formData.append('tableName', tableName.trim());
      formData.append('action', 'inspect');

      const response = await fetch('/api/excel/sisense/smodel-transfer-table', {
        method: 'POST',
        body: formData,
      });

      const json = (await response.json()) as {
        error?: string;
        sourceMatches?: SmodelTableCandidate[];
        targetMatches?: SmodelTableCandidate[];
      };

      if (!response.ok) {
        throw new Error(json.error || 'Failed to inspect the selected table.');
      }

      const nextSourceMatches = json.sourceMatches ?? [];
      const nextTargetMatches = json.targetMatches ?? [];
      setSourceMatches(nextSourceMatches);
      setTargetMatches(nextTargetMatches);
      setSelectedSourceKey(
        nextSourceMatches.length === 1
          ? `${nextSourceMatches[0].datasetIndex}:${nextSourceMatches[0].tableIndex}`
          : ''
      );
      setSelectedTargetKey(
        nextTargetMatches.length === 1
          ? `${nextTargetMatches[0].datasetIndex}:${nextTargetMatches[0].tableIndex}`
          : ''
      );

      if (!nextSourceMatches.length) {
        setError(`No exact case-sensitive source table matches were found for "${tableName.trim()}".`);
      } else if (nextSourceMatches.length > 1 || nextTargetMatches.length > 1) {
        setSuccess('Select the exact source and target table entries before transferring.');
      } else {
        setSuccess('Exact table matches loaded. Review the selections and run the transfer.');
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to inspect the selected table.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!sourceFile || !targetFile || !tableName.trim() || !selectedSourceKey) return;

    const sourceSelection = parseSelectionKey(selectedSourceKey);
    const targetSelection = selectedTargetKey ? parseSelectionKey(selectedTargetKey) : null;
    if (!sourceSelection) {
      setError('Select an exact source table before transferring.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setPreview(null);

    try {
      const formData = new FormData();
      formData.append('left', sourceFile);
      formData.append('right', targetFile);
      formData.append('tableName', tableName.trim());
      formData.append('action', 'transfer');
      formData.append('sourceDatasetIndex', String(sourceSelection.datasetIndex));
      formData.append('sourceTableIndex', String(sourceSelection.tableIndex));
      if (targetSelection) {
        formData.append('targetDatasetIndex', String(targetSelection.datasetIndex));
        formData.append('targetTableIndex', String(targetSelection.tableIndex));
      }

      const response = await fetch('/api/excel/sisense/smodel-transfer-table', {
        method: 'POST',
        body: formData,
      });

      const json = (await response.json()) as {
        error?: string;
        preview?: SmodelTransferPreview;
        transformedModelText?: string;
        suggestedFilename?: string;
      };

      if (!response.ok || !json.preview || !json.transformedModelText) {
        throw new Error(json.error || 'Failed to transfer the selected table.');
      }

      setPreview(json.preview);
      const blob = new Blob([json.transformedModelText], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = json.suggestedFilename || `${tableName.trim()}.smodel`;
      link.click();
      URL.revokeObjectURL(url);
      setSuccess(`Transferred table "${json.preview.tableName}" and downloaded the transformed target model.`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to transfer the selected table.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={isEmbedded ? '' : 'mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8'}>
      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-sky-600">
              {isEmbedded ? 'Admin Transfer' : 'Standalone Transfer'}
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Table transformation workspace</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Upload two Sisense `.smodel` files, enter the exact case-sensitive table name, review the matching table blocks, and then copy that exact source table block into the target model.
            </p>
          </div>
          <div className="rounded-2xl bg-sky-50 p-3 text-sky-600">
            <Database size={28} />
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <TransferFileCard
            label="Source Model"
            title="From"
            helpText="Upload the model that contains the table you want to copy."
            file={sourceFile}
            onChange={(file) => {
              setSourceFile(file);
              resetTransferState();
            }}
          />
          <TransferFileCard
            label="Target Model"
            title="To"
            helpText="Upload the model that should receive the transferred table."
            file={targetFile}
            onChange={(file) => {
              setTargetFile(file);
              resetTransferState();
            }}
          />
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1 text-sm font-medium text-slate-700">
            Exact Table Name
            <input
              value={tableName}
              onChange={(event) => {
                setTableName(event.target.value);
                setError('');
                setSuccess('');
                setPreview(null);
                setSourceMatches([]);
                setTargetMatches([]);
                setSelectedSourceKey('');
                setSelectedTargetKey('');
              }}
              placeholder="Example: Claim Supplemental"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={handleInspect}
            disabled={!canInspect || loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Inspecting...' : 'Find Exact Matches'}
          </button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={!canRun || loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-sky-200 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload size={16} />
            {loading ? 'Transferring Table...' : 'Transfer Table and Download Smodel'}
          </button>
        </div>

        <p className="mt-3 text-xs font-medium text-slate-500">
          Exact case-sensitive match is used. If more than one table shares the same name, select the exact source and target entry below before transferring.
        </p>

        {(sourceMatches.length || targetMatches.length) ? (
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <TransferCandidateCard
              title="Source Table Matches"
              description="Choose the exact source table block to copy."
              candidates={sourceMatches}
              selectedKey={selectedSourceKey}
              onChange={setSelectedSourceKey}
              emptyText="No exact source matches found."
              required
            />
            <TransferCandidateCard
              title="Target Table Matches"
              description="Choose the exact target table block to overwrite. Leave blank to let the system insert into the resolved target dataset when no exact target match exists."
              candidates={targetMatches}
              selectedKey={selectedTargetKey}
              onChange={setSelectedTargetKey}
              emptyText="No exact target matches found. Transfer will insert into the resolved target dataset if possible."
            />
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        {success ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {success}
          </div>
        ) : null}
      </section>

      {preview ? (
        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="grid gap-3 md:grid-cols-3">
            <TransferStatCard label="Table" value={preview.tableName} />
            <TransferStatCard label="Source Dataset" value={preview.sourceDatasetName || '-'} />
            <TransferStatCard label="Target Dataset" value={preview.targetDatasetName || '-'} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <TransferStatCard label="Existing Target Table" value={preview.targetTableFound ? 'Yes' : 'No'} />
            <TransferStatCard label="Source Joins" value={String(preview.sourceRelations.length)} />
            <TransferStatCard label="Previous Target Joins" value={String(preview.previousTargetRelationCount)} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <TransferStatCard label="Copied Joins" value={String(preview.copiedRelationCount)} />
            <TransferStatCard label="Updated Target Joins" value={String(preview.updatedTargetRelationCount)} />
          </div>

          {preview.warnings.length ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {preview.warnings.join(' ')}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            <TransferPreviewCard title="Source Table Block" body={preview.sourceTableJson} />
            <TransferPreviewCard
              title="Previous Target Table Block"
              body={preview.previousTargetTableJson || 'Target table did not exist before transfer.'}
            />
            <TransferPreviewCard title="Updated Target Table Block" body={preview.updatedTargetTableJson} />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            <TransferRelationCard
              title="Source Table Joins"
              relations={preview.sourceRelations}
              emptyText="No source joins were found for the selected table."
            />
            <TransferRelationCard
              title="Previous Target Joins"
              relations={preview.previousTargetRelations}
              emptyText="No existing target joins were attached to the overwritten table."
            />
            <TransferRelationCard
              title="Copied Joins"
              relations={preview.copiedRelations}
              emptyText="No joins were copied into the target model."
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TransferCandidateCard({
  title,
  description,
  candidates,
  selectedKey,
  onChange,
  emptyText,
  required = false,
}: {
  title: string;
  description: string;
  candidates: SmodelTableCandidate[];
  selectedKey: string;
  onChange: (value: string) => void;
  emptyText: string;
  required?: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/60 p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
      {candidates.length ? (
        <div className="mt-4 space-y-3">
          {!required ? (
            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              <input
                type="radio"
                name={title}
                checked={selectedKey === ''}
                onChange={() => onChange('')}
                className="mt-1"
              />
              <span>Auto-resolve target insertion if no explicit overwrite selection is needed.</span>
            </label>
          ) : null}
          {candidates.map((candidate) => {
            const key = `${candidate.datasetIndex}:${candidate.tableIndex}`;
            return (
              <label key={key} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <input
                  type="radio"
                  name={title}
                  checked={selectedKey === key}
                  onChange={() => onChange(key)}
                  className="mt-1"
                />
                <span className="block">
                  <span className="block font-bold text-slate-900">{candidate.tableName}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Dataset: {candidate.datasetName || '-'} | Schema: {candidate.schemaName || '-'} | Type: {candidate.tableType || '-'} | Id: {candidate.tableId || '-'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
          {emptyText}
        </div>
      )}
    </div>
  );
}

function TransferFileCard({
  label,
  title,
  helpText,
  file,
  onChange,
}: {
  label: string;
  title: string;
  helpText: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="block rounded-[28px] border border-slate-200 bg-slate-50/70 p-6">
      <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <div className="mt-2 text-xl font-black tracking-tight text-slate-900">{title}</div>
      <p className="mt-2 text-sm text-slate-500">{helpText}</p>
      <input
        type="file"
        accept=".smodel,.json"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        className="mt-4 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-600">
        {file ? file.name : 'No file selected'}
      </div>
    </label>
  );
}

function TransferStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-2 break-all text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function TransferPreviewCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{title}</p>
      </div>
      <pre className="max-h-[28rem] overflow-auto bg-slate-950 px-4 py-4 text-xs text-slate-100">{body}</pre>
    </div>
  );
}

function TransferRelationCard({
  title,
  relations,
  emptyText,
}: {
  title: string;
  relations: SmodelTransferRelationPreview[];
  emptyText: string;
}) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{title}</p>
      </div>
      {relations.length ? (
        <div className="max-h-[28rem] space-y-3 overflow-auto bg-slate-50 p-4">
          {relations.map((relation, index) => (
            <div key={`${relation.relationOid || 'relation'}-${index}`} className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3">
                <p className="text-xs font-bold text-slate-900">{relation.summary || 'Join identified'}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  OID: {relation.relationOid || '-'} | Type: {relation.relationType || '-'}
                </p>
              </div>
              <pre className="overflow-auto bg-slate-950 px-4 py-4 text-xs text-slate-100">{relation.json}</pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-4 text-sm text-slate-500">{emptyText}</div>
      )}
    </div>
  );
}
