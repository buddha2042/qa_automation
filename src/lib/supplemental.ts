import { normalizeBaseUrl, sanitizeBearerToken } from '@/lib/network';
import { resolveSisenseBearer, type SisenseAuthInput } from '@/lib/sisenseAuth';

export interface SupplementalCatalogItem {
  BASE_SUPPEMENTAL: string;
  UI_VEIW_SUPPLEMENTAL?: string;
  ELASTICUBE_TABLE_NAME: string;
  IS_TABLEQUERY?: string;
  SQL_QUERY?: string;
}

export interface SupplementalFieldCatalogItem {
  SUPP_TABLE_NAME: string;
  SYS_FIELD_NAME: string;
  FIELD_TYPE: string;
  USER_PROMPT: string;
}

export interface SupplementalPreviewField {
  tableName: string;
  baseColumn: string;
  cubeColumn: string;
  fieldType: string;
  existsInCube: boolean;
}

export interface SupplementalPreviewResult {
  datamodelId: string;
  datamodelTitle: string;
  baseSupplemental: string;
  cubeTableName: string;
  tableFound: boolean;
  existingColumnNames: string[];
  fields: SupplementalPreviewField[];
}

export interface SisenseDatamodelOption {
  oid: string;
  title: string;
}

interface SisenseSchemaColumn {
  name?: string;
}

interface SisenseSchemaTable {
  name?: string;
  columns?: SisenseSchemaColumn[];
}

interface SisenseSchemaDataset {
  schema?: {
    tables?: SisenseSchemaTable[];
  };
}

interface SisenseSchemaRoot {
  title?: string;
  datasets?: SisenseSchemaDataset[];
}

interface SisenseBuildResponse {
  oid?: string;
  status?: string;
  schemaLastUpdate?: string;
  error?: {
    title?: string;
    reason?: string;
  };
}

const DEFAULT_LEGACY_API_BASE_URL = 'http://localhost:5000/api';

export function getLegacySupplementalApiBaseUrl(): string {
  return (process.env.LEGACY_ASSURE_API_BASE_URL?.trim() || DEFAULT_LEGACY_API_BASE_URL).replace(/\/+$/, '');
}

function buildLegacyUrl(path: string): string {
  const base = getLegacySupplementalApiBaseUrl();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function getLegacyFallbackBaseUrls(): string[] {
  const configured = getLegacySupplementalApiBaseUrl();
  const candidates = [
    configured,
    'http://localhost:5000/api',
    'https://localhost:5001/api',
    'http://localhost:32323/api',
    'https://localhost:44387/api',
    'http://localhost/DXCAssureInsightsRestAPI/api',
  ];

  return Array.from(new Set(candidates.map((value) => value.replace(/\/+$/, ''))));
}

async function parseJsonOrText<T>(response: Response): Promise<T | string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return await response.text();
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const direct = record.message ?? record.reason ?? record.error;
    if (typeof direct === 'string' && direct.trim()) return direct;
    const nestedError = record.error;
    if (nestedError && typeof nestedError === 'object') {
      const nestedRecord = nestedError as Record<string, unknown>;
      const nested = nestedRecord.message ?? nestedRecord.reason ?? nestedRecord.title;
      if (typeof nested === 'string' && nested.trim()) return nested;
    }
  }
  return fallback;
}

async function fetchLegacyJson<T>(path: string): Promise<T> {
  let lastError: Error | null = null;
  const attemptedUrls: string[] = [];

  for (const baseUrl of getLegacyFallbackBaseUrls()) {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    attemptedUrls.push(url);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });

      const payload = await parseJsonOrText<T>(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `Legacy API request failed (${response.status}) at ${url}`));
      }

      return payload as T;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error(`Legacy API request failed for ${url}`);
    }
  }

  const attemptedList = attemptedUrls.join(', ');
  if (lastError?.message) {
    throw new Error(
      `${lastError.message}. Tried: ${attemptedList}. Set LEGACY_ASSURE_API_BASE_URL if it is hosted elsewhere.`
    );
  }

  throw new Error(
    `Could not reach the legacy supplemental API. Tried: ${attemptedList}. Set LEGACY_ASSURE_API_BASE_URL if it is hosted elsewhere.`
  );
}

export async function fetchSupplementalCatalog(): Promise<SupplementalCatalogItem[]> {
  const payload = await fetchLegacyJson<SupplementalCatalogItem[]>('/SuppDictionary/getsuppcatalog');
  return Array.isArray(payload)
    ? payload
        .filter((item) => item && item.BASE_SUPPEMENTAL && item.ELASTICUBE_TABLE_NAME)
        .sort((left, right) => left.ELASTICUBE_TABLE_NAME.localeCompare(right.ELASTICUBE_TABLE_NAME))
    : [];
}

export async function fetchSupplementalFields(baseSupplemental: string): Promise<SupplementalFieldCatalogItem[]> {
  const payload = await fetchLegacyJson<SupplementalFieldCatalogItem[]>(
    `/SuppDictionary/getsuppfields?supptablename=${encodeURIComponent(baseSupplemental)}`
  );
  return Array.isArray(payload) ? payload : [];
}

export function toCubeColumnName(fieldType: string, prompt: string): string {
  const normalizedPrompt = prompt.trim();
  if (fieldType === '6' || fieldType === '9') return `${normalizedPrompt} Code`;
  if (fieldType === '31') return `${normalizedPrompt} Flag`;
  return normalizedPrompt;
}

export function toSupplementalPayloadFields(fields: SupplementalPreviewField[]) {
  return fields.map((field) => ({
    BaseColumn: field.baseColumn,
    CubeColumn: field.cubeColumn,
    FieldType: field.fieldType,
  }));
}

export async function fetchSisenseDatamodels(
  inputBaseUrl: string,
  auth: SisenseAuthInput
): Promise<{ baseUrl: string; token: string; datamodels: SisenseDatamodelOption[] }> {
  const baseUrl = normalizeBaseUrl(inputBaseUrl);
  const token = await resolveSisenseBearer(baseUrl, auth);
  const response = await fetch(`${baseUrl}/api/v2/datamodels/schema?oid,title`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = await parseJsonOrText<SisenseDatamodelOption[]>(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Failed to load datamodels (${response.status})`));
  }

  const datamodels = Array.isArray(payload)
    ? payload
        .filter((item) => item && item.oid && item.title)
        .sort((left, right) => left.title.localeCompare(right.title))
    : [];

  return { baseUrl, token, datamodels };
}

export async function fetchSisenseSchema(
  inputBaseUrl: string,
  auth: SisenseAuthInput,
  datamodelId: string
): Promise<{ baseUrl: string; token: string; schema: SisenseSchemaRoot }> {
  const baseUrl = normalizeBaseUrl(inputBaseUrl);
  const token = await resolveSisenseBearer(baseUrl, auth);
  return {
    baseUrl,
    token,
    schema: await fetchSisenseSchemaWithToken(baseUrl, token, datamodelId),
  };
}

export async function fetchSisenseSchemaWithToken(
  baseUrl: string,
  token: string,
  datamodelId: string
): Promise<SisenseSchemaRoot> {
  const response = await fetch(`${baseUrl}/api/v2/datamodels/${encodeURIComponent(datamodelId)}/schema`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${sanitizeBearerToken(token)}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = await parseJsonOrText<SisenseSchemaRoot>(response);
  if (!response.ok || typeof payload === 'string') {
    throw new Error(getErrorMessage(payload, `Failed to load datamodel schema (${response.status})`));
  }

  return payload;
}

function collectExistingColumnNames(schema: SisenseSchemaRoot, cubeTableName: string): string[] {
  const names: string[] = [];
  for (const dataset of schema.datasets ?? []) {
    for (const table of dataset.schema?.tables ?? []) {
      if ((table.name ?? '').trim() !== cubeTableName.trim()) continue;
      for (const column of table.columns ?? []) {
        const name = String(column.name ?? '').trim();
        if (name) names.push(name);
      }
    }
  }
  return names;
}

export async function buildSupplementalPreview(
  inputBaseUrl: string,
  auth: SisenseAuthInput,
  datamodelId: string,
  catalogItem: SupplementalCatalogItem
): Promise<SupplementalPreviewResult> {
  const { schema } = await fetchSisenseSchema(inputBaseUrl, auth, datamodelId);
  const fields = await fetchSupplementalFields(catalogItem.BASE_SUPPEMENTAL);
  const existingColumnNames = collectExistingColumnNames(schema, catalogItem.ELASTICUBE_TABLE_NAME);
  const existingColumnSet = new Set(existingColumnNames.map((name) => name.toLowerCase()));

  return {
    datamodelId,
    datamodelTitle: String(schema.title ?? ''),
    baseSupplemental: catalogItem.BASE_SUPPEMENTAL,
    cubeTableName: catalogItem.ELASTICUBE_TABLE_NAME,
    tableFound: existingColumnNames.length > 0,
    existingColumnNames,
    fields: fields.map((field) => {
      const cubeColumn = toCubeColumnName(field.FIELD_TYPE, field.USER_PROMPT);
      return {
        tableName: field.SUPP_TABLE_NAME,
        baseColumn: field.SYS_FIELD_NAME,
        cubeColumn,
        fieldType: field.FIELD_TYPE,
        existsInCube: existingColumnSet.has(cubeColumn.toLowerCase()),
      };
    }),
  };
}

export async function checkSisenseBuildInProgress(
  baseUrl: string,
  token: string,
  datamodelTitle: string
): Promise<boolean> {
  const encodedServer = encodeURIComponent(baseUrl);
  const response = await fetch(
    `${baseUrl}/api/v1/elasticubes/servers/next/${encodedServer}/${encodeURIComponent(datamodelTitle)}/isBuilding`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sanitizeBearerToken(token)}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) return false;
  return (await response.text()).trim().toLowerCase() === 'true';
}

export async function applySupplementalFields(
  inputBaseUrl: string,
  auth: SisenseAuthInput,
  datamodelId: string,
  datamodelTitle: string,
  cubeTableName: string,
  fields: SupplementalPreviewField[]
): Promise<{ build: SisenseBuildResponse | null; appliedCount: number }> {
  const baseUrl = normalizeBaseUrl(inputBaseUrl);
  const token = await resolveSisenseBearer(baseUrl, auth);

  if (datamodelTitle.trim()) {
    const isBuilding = await checkSisenseBuildInProgress(baseUrl, token, datamodelTitle.trim());
    if (isBuilding) {
      throw new Error(`Build is already in progress for datamodel "${datamodelTitle}". Try again later.`);
    }
  }

  const response = await fetch(
    `${buildLegacyUrl('/DataModel/addsupplemental')}?HostName=${encodeURIComponent(baseUrl)}&flag=1&datamodelid=${encodeURIComponent(datamodelId)}&tablename=${encodeURIComponent(cubeTableName)}&columntype=4`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(toSupplementalPayloadFields(fields)),
      cache: 'no-store',
    }
  );

  const payload = await parseJsonOrText<unknown>(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Failed to apply supplemental fields (${response.status})`));
  }

  const build = await triggerSisenseBuild(baseUrl, token, datamodelId);
  return {
    build,
    appliedCount: fields.length,
  };
}

export async function triggerSisenseBuild(
  baseUrl: string,
  token: string,
  datamodelId: string
): Promise<SisenseBuildResponse | null> {
  const response = await fetch(`${baseUrl}/api/v2/builds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sanitizeBearerToken(token)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      datamodelId,
      buildType: 'full',
      rowLimit: 0,
      schemaOrigin: 'latest',
    }),
    cache: 'no-store',
  });

  const payload = await parseJsonOrText<SisenseBuildResponse>(response);
  if (!response.ok || typeof payload === 'string') {
    throw new Error(getErrorMessage(payload, `Failed to trigger build (${response.status})`));
  }

  return payload;
}
