'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

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

export interface QaInputs {
  regUrl: string;
  regToken: string;
  regDashId: string;
  regWidgetId: string;
  refUrl: string;
  refToken: string;
  refDashId: string;
  refWidgetId: string;
}

export type QaPhase =
  | 'INIT'
  | 'WIDGET_QA_RUNNING'
  | 'WIDGET_QA_DONE'
  | 'DATA_AUDIT_PENDING'
  | 'DATA_COMPARE_RUNNING'
  | 'DATA_COMPARE_DONE';

export interface QaState {
  inputs: QaInputs | null;
  jwtToken: string | null;
  regularData: JsonValue | null;
  refactorData: JsonValue | null;
  comparisonReport: ComparisonItem[];
  phase: QaPhase;
  createdAt: string | null;
  dataCompareResult?: {
    regularRowCount: number;
    refactorRowCount: number;
    mismatches?: number;
  };
}

interface QaContextType extends QaState {
  setQaState: React.Dispatch<React.SetStateAction<QaState>>;
  updateQaState: (partial: Partial<QaState>) => void;
  resetQa: () => void;
}

const defaultState: QaState = {
  inputs: null,
  jwtToken: null,
  regularData: null,
  refactorData: null,
  comparisonReport: [],
  phase: 'INIT',
  createdAt: null,
};

const QaContext = createContext<QaContextType | null>(null);

export const QaProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<QaState>(defaultState);

  const updateQaState = (partial: Partial<QaState>) => {
    setState((prev) => {
      const newState = { ...prev, ...partial };

      if (partial.inputs && prev.inputs) {
        newState.inputs = {
          ...prev.inputs,
          ...partial.inputs,
        };
      }

      return newState;
    });
  };

  const resetQa = () => setState(defaultState);

  return (
    <QaContext.Provider
      value={{
        ...state,
        setQaState: setState,
        updateQaState,
        resetQa,
      }}
    >
      {children}
    </QaContext.Provider>
  );
};

export const useQa = () => {
  const context = useContext(QaContext);
  if (!context) {
    throw new Error('useQa must be used within a QaProvider');
  }
  return context;
};
