import { NextResponse } from 'next/server';
import {
  listSmodelTransferCandidates,
  transferSmodelTable,
  type SmodelDocument,
} from '@/lib/smodelTransfer';
import {
  loadSisenseElasticubes,
  resolveElasticubeByOid,
  toElasticubeOption,
  updateSisenseElasticube,
} from '@/lib/sisenseElasticubes';
import { hasSisenseAuth, type SisenseAuthInput } from '@/lib/sisenseAuth';
import { isUploadedFile } from '@/lib/uploadedFile';

export const runtime = 'nodejs';

interface TargetSide extends SisenseAuthInput {
  baseUrl?: string;
  cubeOid?: string;
}

interface JsonRequestBody {
  action?: 'load-cubes' | 'apply';
  target?: TargetSide;
  transformedModelText?: string;
  tableName?: string;
}

const toOptionalInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const getTableCount = (model: SmodelDocument) =>
  Array.isArray(model.datasets)
    ? model.datasets.reduce((sum, dataset) => {
      const tables = Array.isArray(dataset?.schema?.tables) ? dataset.schema.tables.length : 0;
      return sum + tables;
    }, 0)
    : 0;

const summarizeApplyPayload = (model: SmodelDocument) => ({
  oid: String(model.oid ?? ''),
  _id: String(model._id ?? ''),
  title: String(model.title ?? ''),
  server: String(model.server ?? ''),
  type: String(model.type ?? ''),
  datasetCount: Array.isArray(model.datasets) ? model.datasets.length : 0,
  tableCount: getTableCount(model),
  relationCount: Array.isArray(model.relations) ? model.relations.length : 0,
});

const findTableByName = (model: SmodelDocument, tableName: string) => {
  for (const dataset of model.datasets ?? []) {
    for (const table of dataset.schema?.tables ?? []) {
      if (String(table?.name ?? '').trim() === tableName) {
        return { dataset, table };
      }
    }
  }
  return null;
};

const summarizeTablePayload = (
  model: SmodelDocument,
  tableName: string,
  focusColumnName?: string
) => {
  const tableMatch = findTableByName(model, tableName);
  if (!tableMatch) {
    return {
      tableName,
      found: false,
    };
  }

  const { dataset, table } = tableMatch;
  const normalizedFocusColumnName = String(focusColumnName ?? '').trim();
  const column = normalizedFocusColumnName
    ? (table.columns ?? []).find(
      (entry) => String(entry?.name ?? entry?.id ?? '').trim() === normalizedFocusColumnName
    ) ?? null
    : null;
  const columnOid = String(column?.oid ?? '').trim();
  const matchingTransforms = (table.tupleTransformations ?? []).filter((transform) => {
    const args = (transform?.arguments ?? {}) as Record<string, unknown>;
    return String(args.column ?? '').trim() === columnOid;
  });
  const matchingRelations = (model.relations ?? []).flatMap((relation) =>
    (relation.columns ?? [])
      .filter((ref) => String(ref?.table ?? '').trim() === String(table.oid ?? '').trim()
        && String(ref?.column ?? '').trim() === columnOid)
      .map((ref) => ({
        relationOid: String(relation?.oid ?? ''),
        ref,
      }))
  );

  return {
    tableName,
    found: true,
    datasetName: String(dataset?.name ?? dataset?.oid ?? ''),
    tableOid: String(table?.oid ?? ''),
    tableHidden: table?.hidden,
    columnCount: Array.isArray(table.columns) ? table.columns.length : 0,
    addColumnNames: (table.tupleTransformations ?? [])
      .filter((transform) => String(transform?.type ?? '').trim() === 'add-column')
      .map((transform) => {
        const args = (transform?.arguments ?? {}) as Record<string, unknown>;
        return String(args.name ?? args.id ?? args.columnName ?? '').trim();
      })
      .filter(Boolean),
    ...(normalizedFocusColumnName
      ? {
        columnName: normalizedFocusColumnName,
        column,
        matchingTransforms,
        matchingRelations,
      }
      : {}),
  };
};

async function handleJsonRequest(request: Request) {
  const body = (await request.json()) as JsonRequestBody;
  const action = String(body.action ?? '').trim();
  const targetBaseUrlInput = String(body.target?.baseUrl ?? '').trim();

  if (!targetBaseUrlInput) {
    return NextResponse.json({ error: 'Enter the target Sisense base URL.' }, { status: 400 });
  }

  if (!hasSisenseAuth(body.target ?? {})) {
    return NextResponse.json(
      { error: 'Provide either a target Sisense API token or a username and password.' },
      { status: 400 }
    );
  }

  const targetPayload = await loadSisenseElasticubes(targetBaseUrlInput, body.target ?? {});

  if (action === 'load-cubes') {
    return NextResponse.json({
      target: {
        baseUrl: targetPayload.baseUrl,
        elasticubes: targetPayload.elasticubes.map(toElasticubeOption),
      },
    });
  }

  if (action !== 'apply') {
    return NextResponse.json({ error: 'Unsupported JSON action.' }, { status: 400 });
  }

  const targetCubeOid = String(body.target?.cubeOid ?? '').trim();
  if (!targetCubeOid) {
    return NextResponse.json({ error: 'Choose the target Elasticube to update.' }, { status: 400 });
  }

  const transformedModelText = String(body.transformedModelText ?? '').trim();
  if (!transformedModelText) {
    return NextResponse.json({ error: 'No transformed model is available to apply.' }, { status: 400 });
  }
  const currentTableName = String(body.tableName ?? '').trim();

  const targetCube = resolveElasticubeByOid(targetPayload.elasticubes, targetCubeOid);
  if (!targetCube) {
    return NextResponse.json(
      { error: 'The selected target Elasticube was not found in the latest Sisense response.' },
      { status: 404 }
    );
  }

  let transformedModel: SmodelDocument;
  try {
    transformedModel = JSON.parse(transformedModelText) as SmodelDocument;
  } catch {
    return NextResponse.json({ error: 'The transformed model payload is not valid JSON.' }, { status: 400 });
  }

  const liveTargetModel: SmodelDocument = {
    ...transformedModel,
    oid: targetCube.oid ?? transformedModel.oid,
    _id: targetCube._id ?? transformedModel._id,
    title: targetCube.title ?? transformedModel.title,
    server: targetCube.server ?? transformedModel.server,
    type: targetCube.type ?? transformedModel.type,
  };

  const applyLogContext = {
    action: 'apply',
    targetCubeOid,
    requestSummary: summarizeApplyPayload(liveTargetModel),
  };
  console.log('[smodel-transfer] updateCube request summary', applyLogContext);
  console.log('[smodel-transfer] updateCube request payload', JSON.stringify(liveTargetModel, null, 2));
  console.log(
    '[smodel-transfer] updateCube request focus',
    JSON.stringify(
      {
        currentTable: currentTableName
          ? summarizeTablePayload(liveTargetModel, currentTableName)
          : null,
      },
      null,
      2
    )
  );

  const updateResult = await updateSisenseElasticube(targetPayload.baseUrl, body.target ?? {}, liveTargetModel);
  console.log('[smodel-transfer] updateCube response summary', {
    ...applyLogContext,
    endpoint: updateResult.endpoint,
    status: updateResult.status,
    responseType: typeof updateResult.payload,
    responsePayload: updateResult.payload,
  });

  return NextResponse.json({
    targetCube: toElasticubeOption(liveTargetModel),
    message: `Updated Elasticube "${String(liveTargetModel.title ?? targetCube.title ?? '')}" in Sisense.`,
    updateResult: updateResult.payload,
  });
}

async function handleFormRequest(request: Request) {
  const formData = await request.formData();
  const leftFile = formData.get('left');
  const rightFile = formData.get('right');
  const action = String(formData.get('action') ?? 'transfer').trim();
  const tableName = String(formData.get('tableName') ?? '').trim();

  if (!isUploadedFile(leftFile) || !isUploadedFile(rightFile)) {
    return NextResponse.json(
      { error: 'Upload both cube model files using fields left and right.' },
      { status: 400 }
    );
  }

  if (!tableName) {
    return NextResponse.json({ error: 'Enter a table name to transfer.' }, { status: 400 });
  }

  const sourceText = Buffer.from(await leftFile.arrayBuffer()).toString('utf-8');
  const targetText = Buffer.from(await rightFile.arrayBuffer()).toString('utf-8');
  const sourceModel = JSON.parse(sourceText) as SmodelDocument;
  const targetModel = JSON.parse(targetText) as SmodelDocument;

  if (action === 'inspect') {
    return NextResponse.json(listSmodelTransferCandidates(sourceModel, targetModel, tableName));
  }

  const result = transferSmodelTable(sourceModel, targetModel, tableName, {
    sourceDatasetIndex: toOptionalInteger(formData.get('sourceDatasetIndex')),
    sourceTableIndex: toOptionalInteger(formData.get('sourceTableIndex')),
    targetDatasetIndex: toOptionalInteger(formData.get('targetDatasetIndex')),
    targetTableIndex: toOptionalInteger(formData.get('targetTableIndex')),
    excludedAddedColumnNames: formData
      .getAll('excludedAddedColumnNames')
      .map((value) => String(value).trim())
      .filter(Boolean),
  });

  return NextResponse.json({
    preview: result.preview,
    transformedModelText: JSON.stringify(result.transformedModel, null, 2),
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return await handleJsonRequest(request);
    }

    return await handleFormRequest(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to transfer the selected table.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
