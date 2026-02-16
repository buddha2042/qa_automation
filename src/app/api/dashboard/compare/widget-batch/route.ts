import { NextResponse } from 'next/server';
import {
  compareSingleWidget,
  type CompareSingleWidgetInput,
  type DashboardCompareCredentials,
} from '@/lib/dashboardCompare';

interface CompareBatchRequestBody {
  regular?: { url?: string; token?: string };
  refactor?: { url?: string; token?: string };
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
      !isNonEmpty(body.regular?.token) ||
      !isNonEmpty(body.refactor?.url) ||
      !isNonEmpty(body.refactor?.token)
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

    const credentials: DashboardCompareCredentials = {
      regular: {
        url: body.regular.url.trim(),
        token: body.regular.token.trim(),
      },
      refactor: {
        url: body.refactor.url.trim(),
        token: body.refactor.token.trim(),
      },
    };

    const results = await Promise.all(
      body.selections.map(async (selection) => {
        const result = await compareSingleWidget(credentials, selection);
        return {
          key:
            selection.key ??
            `${selection.regularDashboardId}::${selection.refactorDashboardId}::${selection.widgetId}`,
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
