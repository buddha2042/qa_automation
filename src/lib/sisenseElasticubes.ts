import { normalizeBaseUrl } from '@/lib/network';
import { resolveSisenseBearer, type SisenseAuthInput } from '@/lib/sisenseAuth';
import type { SmodelDocument } from '@/lib/smodelTransfer';

export interface SisenseElasticubeModel extends SmodelDocument {
  _id?: string;
  oid?: string;
  title?: string;
  type?: string;
  server?: string;
  [key: string]: unknown;
}

export interface SisenseElasticubeOption {
  oid: string;
  title: string;
  server: string;
  type: string;
  datasetCount: number;
  tableCount: number;
  hasAnyTables: boolean;
  hasFullModel: boolean;
}

const getTableCount = (cube: SisenseElasticubeModel) => {
  const datasets = Array.isArray(cube.datasets) ? cube.datasets : [];
  return datasets.reduce((sum, dataset) => {
    const schemaTables = Array.isArray(dataset?.schema?.tables) ? dataset.schema.tables.length : 0;
    const flatTables = Array.isArray((dataset as { tables?: unknown[] }).tables)
      ? ((dataset as { tables?: unknown[] }).tables?.length ?? 0)
      : 0;
    return sum + Math.max(schemaTables, flatTables);
  }, 0);
};

const extractElasticubes = (payload: unknown): SisenseElasticubeModel[] => {
  if (Array.isArray(payload)) {
    return payload as SisenseElasticubeModel[];
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.elasticubes, record.data, record.items, record.results];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as SisenseElasticubeModel[];
    }
  }

  return [];
};

const getApiUrl = (baseUrl: string, path: string) => `${baseUrl}/api/v1${path}`;
const getV2ApiUrl = (baseUrl: string, path: string) => `${baseUrl}/api/v2${path}`;

const parseResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? await response.json() : await response.text();
};

const getErrorMessage = (payload: unknown, fallback: string) => {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
      return String((error as { message?: unknown }).message);
    }
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
  }

  return fallback;
};

async function fetchElasticubesPayload(baseUrl: string, token: string) {
  const endpoints: Array<() => Promise<Response>> = [
    () =>
      fetch(getApiUrl(baseUrl, '/elasticubes/getElasticubes'), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      }),
    () =>
      fetch(getApiUrl(baseUrl, '/elasticubes/getElasticubes'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        cache: 'no-store',
      }),
  ];

  let lastError = 'Sisense did not return Elasticubes.';

  for (const request of endpoints) {
    const response = await request();
    const payload = await parseResponse(response);

    if (response.ok) {
      return payload;
    }

    lastError = getErrorMessage(payload, `Sisense returned ${response.status} while loading Elasticubes.`);
  }

  throw new Error(lastError);
}

export async function loadSisenseElasticubes(
  baseUrlInput: string,
  auth: SisenseAuthInput
): Promise<{ baseUrl: string; token: string; elasticubes: SisenseElasticubeModel[] }> {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const token = await resolveSisenseBearer(baseUrl, auth);
  const payload = await fetchElasticubesPayload(baseUrl, token);
  const elasticubes = extractElasticubes(payload);

  if (!elasticubes.length) {
    throw new Error('Sisense returned no Elasticubes for this account.');
  }

  return { baseUrl, token, elasticubes };
}

export function toElasticubeOption(cube: SisenseElasticubeModel): SisenseElasticubeOption {
  const datasets = Array.isArray(cube.datasets) ? cube.datasets : [];
  const tableCount = getTableCount(cube);

  return {
    oid: String(cube.oid ?? cube._id ?? ''),
    title: String(cube.title ?? ''),
    server: String(cube.server ?? ''),
    type: String(cube.type ?? ''),
    datasetCount: datasets.length,
    tableCount,
    hasAnyTables: tableCount > 0,
    hasFullModel: datasets.length > 0,
  };
}

export function resolveElasticubeByOid(
  elasticubes: SisenseElasticubeModel[],
  oid: string
): SisenseElasticubeModel | null {
  return elasticubes.find((cube) => String(cube.oid ?? cube._id ?? '') === oid) ?? null;
}

async function fetchDatamodelByOid(baseUrl: string, token: string, oid: string) {
  const response = await fetch(getV2ApiUrl(baseUrl, `/datamodels/${encodeURIComponent(oid)}`), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Sisense returned ${response.status} while loading datamodel ${oid}.`));
  }

  return payload as SisenseElasticubeModel;
}

export async function fetchSisenseDatamodelByOid(
  baseUrlInput: string,
  auth: SisenseAuthInput,
  oid: string
): Promise<SisenseElasticubeModel> {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const token = await resolveSisenseBearer(baseUrl, auth);
  return fetchDatamodelByOid(baseUrl, token, oid);
}

export async function hydrateElasticubeIfNeeded(
  baseUrlInput: string,
  auth: SisenseAuthInput,
  cube: SisenseElasticubeModel
): Promise<SisenseElasticubeModel> {
  if (getTableCount(cube) > 0) {
    return cube;
  }

  const oid = String(cube.oid ?? cube._id ?? '').trim();
  if (!oid) {
    return cube;
  }

  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const token = await resolveSisenseBearer(baseUrl, auth);
  const hydrated = await fetchDatamodelByOid(baseUrl, token, oid);

  return {
    ...cube,
    ...hydrated,
    oid: hydrated.oid ?? cube.oid,
    _id: hydrated._id ?? cube._id,
    title: hydrated.title ?? cube.title,
    server: hydrated.server ?? cube.server,
    type: hydrated.type ?? cube.type,
  };
}


export async function updateSisenseElasticube(
  baseUrlInput: string,
  auth: SisenseAuthInput,
  cube: SisenseElasticubeModel
) {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const token = await resolveSisenseBearer(baseUrl, auth);
  const server = String(cube.server ?? '').trim();
  const title = String(cube.title ?? '').trim();

  if (!server || !title) {
    throw new Error('Target Elasticube is missing a server or title, so updateCube cannot be called.');
  }

  const endpoint = getApiUrl(
    baseUrl,
    `/elasticubes/${encodeURIComponent(server)}/${encodeURIComponent(title)}/updateCube`
  );

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cube),
    cache: 'no-store',
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Sisense returned ${response.status} while updating the target Elasticube.`));
  }

  return {
    baseUrl,
    endpoint,
    status: response.status,
    payload,
  };
}
