'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

/* ============================================================
   TYPES & INTERFACES
   ============================================================ */

export interface ComparisonItem {
  path: string;
  regularValue: any;
  refactorValue: any;
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
  /* Connection & Auth */
  inputs: QaInputs | null;
  jwtToken: string | null;

  /* Widget Logic (Phase 1) */
  regularData: any | null;
  refactorData: any | null;
  comparisonReport: ComparisonItem[];

  /* Phase Control */
  phase: QaPhase;

  /* Metadata */
  createdAt: string | null;

  /* Data Comparison Results (Phase 2) */
  dataCompareResult?: {
    regularRowCount: number;
    refactorRowCount: number;
    mismatches?: number;
  };
}

/* ============================================================
   CONTEXT SHAPE
   ============================================================ */

interface QaContextType extends QaState {
  /** Replaces the entire state object */
  setQaState: React.Dispatch<React.SetStateAction<QaState>>;

  /** 
   * Preferred Method: Merges changes into the current state.
   * Special handling for 'inputs' to prevent token data-loss.
   */
  updateQaState: (partial: Partial<QaState>) => void;

  /** Resets the entire lab back to INIT state */
  resetQa: () => void;
}

/* ============================================================
   DEFAULT STATE
   ============================================================ */

const defaultState: QaState = {
  inputs: null,
  jwtToken: null,
  regularData: null,
  refactorData: null,
  comparisonReport: [],
  phase: 'INIT',
  createdAt: null
};

/* ============================================================
   CONTEXT CREATION
   ============================================================ */

const QaContext = createContext<QaContextType | null>(null);

/* ============================================================
   PROVIDER COMPONENT
   ============================================================ */

export const QaProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<QaState>(defaultState);

  /**
   * updateQaState Fix:
   * Standard React shallow merging ({...prev, ...partial}) wipes out
   * nested objects. If we only update inputs.regUrl, we would lose
   * inputs.regToken. This logic ensures nested 'inputs' are merged properly.
   */
  const updateQaState = (partial: Partial<QaState>) => {
    setState((prev) => {
      // 1. Create a shallow copy of the state with the top-level changes
      const newState = { ...prev, ...partial };

      // 2. If 'inputs' is being updated, merge it deeply with the old inputs
      if (partial.inputs && prev.inputs) {
        newState.inputs = {
          ...prev.inputs,
          ...partial.inputs,
        };
      }

      return newState;
    });
  };

  const resetQa = () => {
    setState(defaultState);
  };

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

/* ============================================================
   CUSTOM HOOK
   ============================================================ */

export const useQa = () => {
  const context = useContext(QaContext);
  if (!context) {
    throw new Error('useQa must be used within a QaProvider');
  }
  return context;
};