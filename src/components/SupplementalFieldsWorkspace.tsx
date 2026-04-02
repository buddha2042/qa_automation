'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, LoaderCircle, RefreshCcw, Sparkles, Wrench } from 'lucide-react';
import {
  BASE_URL_PRESET_OPTIONS,
  getPresetFromUrl,
  getUrlForPreset,
  type BaseUrlPreset,
} from '@/lib/sisenseEnvironments';
import type {
  SupplementalCatalogItem,
  SupplementalPreviewField,
  SupplementalPreviewResult,
  SisenseDatamodelOption,
} from '@/lib/supplemental';

interface ApplyResponse {
  appliedCount: number;
  build: {
    oid?: string;
    status?: string;
    schemaLastUpdate?: string;
  } | null;
}

const STORAGE_KEY = 'qa-automation-supplemental-config';

export default function SupplementalFieldsWorkspace({
  variant = 'standalone',
}: {
  variant?: 'standalone' | 'embedded';
}) {
  const isEmbedded = variant === 'embedded';
  const [preset, setPreset] = useState<BaseUrlPreset>('sisense_25_4_sp2');
  const [baseUrl, setBaseUrl] = useState('');
  const [authMode, setAuthMode] = useState<'credentials' | 'token'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [catalog, setCatalog] = useState<SupplementalCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [datamodels, setDatamodels] = useState<SisenseDatamodelOption[]>([]);
  const [datamodelLoading, setDatamodelLoading] = useState(false);
  const [selectedDatamodelId, setSelectedDatamodelId] = useState('');
  const [selectedBaseSupplemental, setSelectedBaseSupplemental] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [preview, setPreview] = useState<SupplementalPreviewResult | null>(null);
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);

  const selectedDatamodel = useMemo(
    () => datamodels.find((item) => item.oid === selectedDatamodelId) ?? null,
    [datamodels, selectedDatamodelId]
  );
  const selectedCatalogItem = useMemo(
    () => catalog.find((item) => item.BASE_SUPPEMENTAL === selectedBaseSupplemental) ?? null,
    [catalog, selectedBaseSupplemental]
  );

  const filteredFields = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const fields = preview?.fields ?? [];
    if (!normalizedSearch) return fields;
    return fields.filter((field) =>
      [field.cubeColumn, field.baseColumn, field.tableName].some((value) =>
        value.toLowerCase().includes(normalizedSearch)
      )
    );
  }, [preview, search]);

  const selectableFields = useMemo(
    () => (preview?.fields ?? []).filter((field) => !field.existsInCube),
    [preview]
  );

  useEffect(() => {
    setBaseUrl(getUrlForPreset('sisense_25_4_sp2', ''));
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        baseUrl?: string;
        authMode?: 'credentials' | 'token';
        username?: string;
        token?: string;
        selectedDatamodelId?: string;
        selectedBaseSupplemental?: string;
      };

      const nextBaseUrl = saved.baseUrl?.trim();
      if (nextBaseUrl) {
        setBaseUrl(nextBaseUrl);
        setPreset(getPresetFromUrl(nextBaseUrl));
      }
      setAuthMode(saved.authMode === 'token' ? 'token' : 'credentials');
      setUsername(saved.username ?? '');
      setToken(saved.token ?? '');
      setSelectedDatamodelId(saved.selectedDatamodelId ?? '');
      setSelectedBaseSupplemental(saved.selectedBaseSupplemental ?? '');
    } catch {
      // Ignore malformed local state.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          baseUrl,
          authMode,
          username,
          token,
          selectedDatamodelId,
          selectedBaseSupplemental,
        })
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [authMode, baseUrl, selectedBaseSupplemental, selectedDatamodelId, token, username]);

  const resetMessages = () => {
    setError('');
    setSuccess('');
    setApplyResult(null);
  };

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    resetMessages();
    try {
      const response = await fetch('/api/excel/sisense/supplemental/catalog', {
        method: 'GET',
        cache: 'no-store',
      });
      const json = (await response.json()) as { catalog?: SupplementalCatalogItem[]; error?: string };
      if (!response.ok || !json.catalog) {
        throw new Error(json.error || 'Failed to load supplemental catalog.');
      }
      setCatalog(json.catalog);
      if (!selectedBaseSupplemental && json.catalog[0]?.BASE_SUPPEMENTAL) {
        setSelectedBaseSupplemental(json.catalog[0].BASE_SUPPEMENTAL);
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Failed to load supplemental catalog.';
      setError(message);
    } finally {
      setCatalogLoading(false);
    }
  }, [selectedBaseSupplemental]);

  const buildAuthPayload = () =>
    authMode === 'token'
      ? { token: token.trim() }
      : {
          username: username.trim(),
          password,
        };

  const loadDatamodels = async () => {
    if (!baseUrl.trim()) {
      setError('Enter a Sisense base URL before loading datamodels.');
      return;
    }

    setDatamodelLoading(true);
    resetMessages();
    setPreview(null);
    setSelectedFieldKeys([]);
    try {
      const response = await fetch('/api/excel/sisense/supplemental/datamodels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          ...buildAuthPayload(),
        }),
      });
      const json = (await response.json()) as { datamodels?: SisenseDatamodelOption[]; error?: string };
      if (!response.ok || !json.datamodels) {
        throw new Error(json.error || 'Failed to load datamodels.');
      }
      setDatamodels(json.datamodels);
      setSelectedDatamodelId((current) =>
        json.datamodels?.some((item) => item.oid === current) ? current : (json.datamodels?.[0]?.oid ?? '')
      );
      setSuccess(`Loaded ${json.datamodels.length} datamodels.`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to load datamodels.';
      setError(message);
    } finally {
      setDatamodelLoading(false);
    }
  };

  const loadPreview = async () => {
    if (!selectedDatamodelId || !selectedBaseSupplemental) {
      setError('Choose a datamodel and supplemental table first.');
      return;
    }

    setPreviewLoading(true);
    resetMessages();
    setPreview(null);
    setSelectedFieldKeys([]);
    try {
      const response = await fetch('/api/excel/sisense/supplemental/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          datamodelId: selectedDatamodelId,
          baseSupplemental: selectedBaseSupplemental,
          ...buildAuthPayload(),
        }),
      });
      const json = (await response.json()) as {
        preview?: SupplementalPreviewResult;
        error?: string;
      };
      if (!response.ok || !json.preview) {
        throw new Error(json.error || 'Failed to build supplemental preview.');
      }

      const nextPreview = json.preview;
      setPreview(nextPreview);
      setSelectedFieldKeys(
        nextPreview.fields.filter((field) => !field.existsInCube).map((field) => `${field.baseColumn}::${field.cubeColumn}`)
      );

      if (!nextPreview.tableFound) {
        setError(
          `Table "${nextPreview.cubeTableName}" is not present in the selected datamodel. Create the table first in the Table Transfer flow.`
        );
      } else {
        setSuccess(
          `Loaded ${nextPreview.fields.length} supplemental fields for "${nextPreview.cubeTableName}". Existing fields were locked automatically.`
        );
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to build supplemental preview.';
      setError(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleField = (field: SupplementalPreviewField) => {
    const key = `${field.baseColumn}::${field.cubeColumn}`;
    setSelectedFieldKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  };

  const selectAllEligible = () => {
    setSelectedFieldKeys(selectableFields.map((field) => `${field.baseColumn}::${field.cubeColumn}`));
  };

  const clearSelection = () => {
    setSelectedFieldKeys([]);
  };

  const handleApply = async () => {
    if (!preview || !preview.tableFound) {
      setError('The selected datamodel does not contain the supplemental target table yet.');
      return;
    }

    const selectedFields = preview.fields.filter((field) =>
      selectedFieldKeys.includes(`${field.baseColumn}::${field.cubeColumn}`)
    );

    if (!selectedFields.length) {
      setError('Select at least one new supplemental field to apply.');
      return;
    }

    setApplyLoading(true);
    resetMessages();
    try {
      const response = await fetch('/api/excel/sisense/supplemental/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          datamodelId: preview.datamodelId,
          datamodelTitle: preview.datamodelTitle,
          cubeTableName: preview.cubeTableName,
          fields: selectedFields,
          ...buildAuthPayload(),
        }),
      });
      const json = (await response.json()) as (ApplyResponse & { error?: string });
      if (!response.ok) {
        throw new Error(json.error || 'Failed to apply supplemental fields.');
      }

      setApplyResult(json);
      setSuccess(
        `Applied ${json.appliedCount} supplemental field${json.appliedCount === 1 ? '' : 's'} to "${preview.cubeTableName}".`
      );
      await loadPreview();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Failed to apply supplemental fields.';
      setError(message);
    } finally {
      setApplyLoading(false);
    }
  };

  return (
    <section className={`${isEmbedded ? '' : 'mx-auto max-w-7xl px-6 py-8'} space-y-6`}>
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-emerald-600">
              Supplemental Sync
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
              Sync a supplemental table into a Sisense cube
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Load the supplemental catalog, compare the selected supplemental table against the datamodel table, and apply only the missing fields before triggering a fresh build.
            </p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
            <Sparkles size={28} />
          </div>
        </div>

        <div className="mt-8 grid gap-5 xl:grid-cols-[1.35fr,0.95fr]">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Connection</p>
                <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900">Sisense target</h3>
              </div>
              <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setAuthMode('credentials')}
                  className={`rounded-xl px-3 py-2 ${authMode === 'credentials' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                >
                  Username
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('token')}
                  className={`rounded-xl px-3 py-2 ${authMode === 'token' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                >
                  Token
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[190px,1fr]">
              <label className="text-sm font-medium text-slate-700">
                Environment Preset
                <select
                  value={preset}
                  onChange={(event) => {
                    const nextPreset = event.target.value as BaseUrlPreset;
                    setPreset(nextPreset);
                    setBaseUrl(getUrlForPreset(nextPreset, baseUrl));
                  }}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {BASE_URL_PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-medium text-slate-700">
                Sisense Base URL
                <input
                  value={baseUrl}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setBaseUrl(nextValue);
                    setPreset(getPresetFromUrl(nextValue));
                  }}
                  placeholder="https://your-sisense-host/"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>

            {authMode === 'credentials' ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  Username
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
            ) : (
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Bearer Token
                <textarea
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </label>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={loadDatamodels}
                disabled={datamodelLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-200 disabled:opacity-60"
              >
                {datamodelLoading ? <LoaderCircle size={16} className="animate-spin" /> : <Database size={16} />}
                {datamodelLoading ? 'Loading...' : 'Load Datamodels'}
              </button>
              <button
                type="button"
                onClick={loadCatalog}
                disabled={catalogLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-60"
              >
                {catalogLoading ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                {catalog.length > 0 ? 'Refresh Catalog' : 'Load Catalog'}
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              The supplemental catalog comes from the legacy Assure Insights API. If it is running on a different host,
              set <code>LEGACY_ASSURE_API_BASE_URL</code> for <code>qa_automation</code>.
            </p>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-blue-50/40 p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-600">Selection</p>
            <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900">Target datamodel and table</h3>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Datamodel
                <select
                  value={selectedDatamodelId}
                  onChange={(event) => setSelectedDatamodelId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select datamodel</option>
                  {datamodels.map((datamodel) => (
                    <option key={datamodel.oid} value={datamodel.oid}>
                      {datamodel.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Supplemental Table
                <select
                  value={selectedBaseSupplemental}
                  onChange={(event) => setSelectedBaseSupplemental(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select supplemental table</option>
                  {catalog.map((item) => (
                    <option key={item.BASE_SUPPEMENTAL} value={item.BASE_SUPPEMENTAL}>
                      {item.ELASTICUBE_TABLE_NAME}
                    </option>
                  ))}
                </select>
              </label>

              {selectedCatalogItem ? (
                <div className="rounded-2xl border border-blue-200 bg-white/80 p-4 text-sm text-slate-600">
                  <div>
                    <span className="font-semibold text-slate-800">Base supplemental:</span>{' '}
                    {selectedCatalogItem.BASE_SUPPEMENTAL}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-slate-800">Cube table:</span>{' '}
                    {selectedCatalogItem.ELASTICUBE_TABLE_NAME}
                  </div>
                  {selectedCatalogItem.IS_TABLEQUERY === '1' ? (
                    <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                      This table is configured as a query-driven supplemental source.
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={loadPreview}
                disabled={previewLoading || !selectedDatamodelId || !selectedBaseSupplemental}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-200 disabled:opacity-60"
              >
                {previewLoading ? <LoaderCircle size={16} className="animate-spin" /> : <Wrench size={16} />}
                {previewLoading ? 'Inspecting...' : 'Load Supplemental Table'}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        {success ? (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <p>{success}</p>
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.25em] text-emerald-600">Preview</p>
              <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                {preview.cubeTableName}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {preview.datamodelTitle || selectedDatamodel?.title || preview.datamodelId}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniStat label="Catalog Fields" value={preview.fields.length} />
              <MiniStat label="Already In Cube" value={preview.fields.filter((field) => field.existsInCube).length} />
              <MiniStat label="Ready To Add" value={preview.fields.filter((field) => !field.existsInCube).length} />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by prompt, base column, or table"
              className="min-w-[260px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={selectAllEligible}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700"
            >
              Select All New
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applyLoading || !selectedFieldKeys.length || !preview.tableFound}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-emerald-200 disabled:opacity-60"
            >
              {applyLoading ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {applyLoading ? 'Applying...' : 'Apply Fields + Build'}
            </button>
          </div>

          <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-200">
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-950 text-white">
                  <tr>
                    <th className="w-14 border border-slate-800 px-4 py-3 font-bold">Add</th>
                    <th className="border border-slate-800 px-4 py-3 font-bold">Cube Column</th>
                    <th className="border border-slate-800 px-4 py-3 font-bold">Base Column</th>
                    <th className="border border-slate-800 px-4 py-3 font-bold">Field Type</th>
                    <th className="border border-slate-800 px-4 py-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFields.map((field) => {
                    const key = `${field.baseColumn}::${field.cubeColumn}`;
                    const isSelected = selectedFieldKeys.includes(key);
                    return (
                      <tr key={key} className={field.existsInCube ? 'bg-slate-50' : 'bg-white'}>
                        <td className="border border-slate-200 px-4 py-3 align-top">
                          <input
                            type="checkbox"
                            checked={field.existsInCube ? true : isSelected}
                            disabled={field.existsInCube}
                            onChange={() => toggleField(field)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                          />
                        </td>
                        <td className="border border-slate-200 px-4 py-3 align-top font-semibold text-slate-800">
                          {field.cubeColumn}
                        </td>
                        <td className="border border-slate-200 px-4 py-3 align-top text-slate-600">
                          {field.baseColumn}
                        </td>
                        <td className="border border-slate-200 px-4 py-3 align-top text-slate-600">
                          {field.fieldType}
                        </td>
                        <td className="border border-slate-200 px-4 py-3 align-top">
                          {field.existsInCube ? (
                            <span className="inline-flex rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-700">
                              Existing
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                              New
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredFields.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                        No supplemental fields matched the current filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {applyResult?.build ? (
            <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-slate-700">
              <div>
                <span className="font-semibold text-slate-900">Build OID:</span>{' '}
                {applyResult.build.oid || 'Not returned'}
              </div>
              <div className="mt-1">
                <span className="font-semibold text-slate-900">Build Status:</span>{' '}
                {applyResult.build.status || 'Submitted'}
              </div>
              {applyResult.build.schemaLastUpdate ? (
                <div className="mt-1">
                  <span className="font-semibold text-slate-900">Schema Last Update:</span>{' '}
                  {applyResult.build.schemaLastUpdate}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
