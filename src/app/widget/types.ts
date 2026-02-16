export type Environment = 'regular' | 'refactor';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ComparisonItem {
  path: string;
  regularValue: JsonValue | undefined;
  refactorValue: JsonValue | undefined;
  isMatch: boolean;
}

export interface WidgetPayload {
  [key: string]: JsonValue;
}

export interface WidgetPanelItem {
  jaql?: {
    title?: string;
    dim?: string;
    formula?: string;
    datatype?: string;
    datasource?: {
      fullname?: string;
    };
    filter?: {
      members?: string[];
    };
  };
  disabled?: boolean;
}

export interface WidgetPanel {
  name?: string;
  items?: WidgetPanelItem[];
}

export interface WidgetPayloadTyped extends WidgetPayload {
  widgetType?: JsonValue;
  widgetSubType?: JsonValue;
  panels?: JsonValue;
  style?: JsonValue;
  datasource?: {
    fullname?: string;
  };
  query?: {
    datasource?: {
      fullname?: string;
    };
    metadata?: Array<{
      jaql?: WidgetPanelItem['jaql'];
      panel?: string;
      disabled?: boolean;
    }>;
    count?: number;
  };
  metadata?: Array<{
    panel?: string;
    disabled?: boolean;
    instanceid?: string;
    jaql?: WidgetPanelItem['jaql'];
    field?: {
      id?: string;
      index?: number;
    };
  }>;
}
