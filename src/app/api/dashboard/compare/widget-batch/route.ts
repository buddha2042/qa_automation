import { NextResponse } from 'next/server';
import {
  compareSingleWidget,
  type CompareSingleWidgetInput,
  type DashboardCompareCredentials,
} from '@/lib/dashboardCompare';
import { normalizeBaseUrl } from '@/lib/network';
import { hasSisenseAuth, resolveSisenseBearer } from '@/lib/sisenseAuth';

interface CompareBatchRequestBody {
  regular?: { url?: string; token?: string; username?: string; password?: string };
  refactor?: { url?: string; token?: string; username?: string; password?: string };
  selections?: Array<
    CompareSingleWidgetInput & {
      key?: string;
    }
  >;
}

const isNonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CompareBatchRequestBody;

    if (
      !isNonEmpty(body.regular?.url) ||
      !hasSisenseAuth(body.regular ?? {}) ||
      !isNonEmpty(body.refactor?.url) ||
      !hasSisenseAuth(body.refactor ?? {})
    ) {
      return NextResponse.json(
        { error: 'regular/refactor credentials are required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.selections) || body.selections.length === 0) {
      return NextResponse.json(
        { error: 'At least one selected widget is required' },
        { status: 400 }
      );
    }

    const regularUrl = normalizeBaseUrl(body.regular.url);
    const refactorUrl = normalizeBaseUrl(body.refactor.url);
    const credentials: DashboardCompareCredentials = {
      regular: {
        url: regularUrl,
        token: await resolveSisenseBearer(regularUrl, body.regular),
      },
      refactor: {
        url: refactorUrl,
        token: await resolveSisenseBearer(refactorUrl, body.refactor),
      },
    };

    const results = await Promise.all(
      body.selections.map(async (selection) => {
        const result = await compareSingleWidget(credentials, selection);
        return {
          key:
            selection.key ??
            `${selection.regularDashboardId}::${selection.refactorDashboardId}::${selection.regularWidgetId}::${selection.refactorWidgetId}`,
          regularDashboardId: selection.regularDashboardId,
          refactorDashboardId: selection.refactorDashboardId,
          ...result,
        };
      })
    );

    return NextResponse.json({ data: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
