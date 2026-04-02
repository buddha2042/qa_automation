'use client';

import { useState } from 'react';
import AppHeader from '@/components/AppHeader';
import SisenseDashboardTransferWorkspace from '@/components/SisenseDashboardTransferWorkspace';
import SisenseUserDashboardInventory from '@/components/SisenseUserDashboardInventory';
import SmodelTableTransferWorkspace from '@/components/SmodelTableTransferWorkspace';
import SupplementalFieldsWorkspace from '@/components/SupplementalFieldsWorkspace';
import { SISENSE_BASE_URLS } from '@/lib/sisenseEnvironments';

type AuditTab =
  | 'widget-inventory'
  | 'function-inventory'
  | 'user-lookup'
  | 'dashboard-transfer'
  | 'table-transfer'
  | 'supplemental-fields';

const TAB_OPTIONS: Array<{ id: AuditTab; label: string; access: 'admin' | 'super-admin' }> = [
  { id: 'widget-inventory', label: 'Widget Inventory', access: 'super-admin' },
  { id: 'function-inventory', label: 'Function Lookup', access: 'super-admin' },
  { id: 'user-lookup', label: 'User Lookup', access: 'super-admin' },
  { id: 'dashboard-transfer', label: 'Dashboard Transfer', access: 'super-admin' },
  { id: 'table-transfer', label: 'Table Transfer', access: 'admin' },
  { id: 'supplemental-fields', label: 'Supplemental Fields', access: 'admin' },
];

export default function AuditPage() {
  const [activeTab, setActiveTab] = useState<AuditTab>('table-transfer');
  const isAdminEnabled = (process.env.NEXT_PUBLIC_ADMIN ?? 'no').trim().toLowerCase() === 'yes';
  const isSuperAdminEnabled = (process.env.NEXT_PUBLIC_SUPER_ADMIN ?? 'no').trim().toLowerCase() === 'yes';
  const canAccessTab = (tab: AuditTab) => {
    const option = TAB_OPTIONS.find((item) => item.id === tab);
    if (!option) return false;
    return option.access === 'super-admin' ? isSuperAdminEnabled : isAdminEnabled;
  };
  const resolvedActiveTab: AuditTab | null = canAccessTab(activeTab) ? activeTab : isAdminEnabled ? 'table-transfer' : null;
  const masterInspectorConfig = {
    baseUrl: SISENSE_BASE_URLS.sisense_25_4_sp2,
    token: '',
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] text-slate-900">
      <AppHeader
        title="Audit"
        subtitle="Audit files, models, widgets, users, and function usage across connected platform sources."
        backHref="/"
      />

      <main className="mx-auto max-w-[1800px] space-y-6 px-6 py-8">
        <section className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
          <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
            {TAB_OPTIONS.map((tab) => {
              const disabled = !canAccessTab(tab.id);

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (!disabled) setActiveTab(tab.id);
                  }}
                  disabled={disabled}
                  aria-disabled={disabled}
                  title={disabled ? (tab.access === 'super-admin' ? 'Super admin access required' : 'Admin access required') : undefined}
                  className={`rounded-xl px-4 py-2 transition ${
                    resolvedActiveTab === tab.id && !disabled
                      ? 'bg-slate-900 text-white'
                      : disabled
                        ? 'cursor-not-allowed text-slate-300'
                        : 'text-slate-600'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </section>

        {!isAdminEnabled ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">Access Restricted</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Admin access required</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Table transfer and supplemental fields are available only for admin users. Widget inventory, function lookup, user lookup, and dashboard transfer require super admin access.
            </p>
          </section>
        ) : !isSuperAdminEnabled && resolvedActiveTab !== 'table-transfer' && resolvedActiveTab !== 'supplemental-fields' ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">Access Restricted</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Super admin access required</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Widget inventory, function lookup, user lookup, and dashboard transfer are available only for super admin users. Table transfer and supplemental fields remain available for admin users.
            </p>
          </section>
        ) : resolvedActiveTab === 'widget-inventory' ? (
          <SisenseUserDashboardInventory
            initialBaseUrl={masterInspectorConfig.baseUrl}
            initialToken={masterInspectorConfig.token}
            mode="widget"
          />
        ) : resolvedActiveTab === 'user-lookup' ? (
          <SisenseUserDashboardInventory
            initialBaseUrl={masterInspectorConfig.baseUrl}
            initialToken={masterInspectorConfig.token}
            mode="user"
          />
        ) : resolvedActiveTab === 'dashboard-transfer' ? (
          <SisenseDashboardTransferWorkspace
            initialBaseUrl={masterInspectorConfig.baseUrl}
            initialToken={masterInspectorConfig.token}
          />
        ) : resolvedActiveTab === 'table-transfer' ? (
          <SmodelTableTransferWorkspace variant="embedded" />
        ) : resolvedActiveTab === 'supplemental-fields' ? (
          <SupplementalFieldsWorkspace variant="embedded" />
        ) : (
          <SisenseUserDashboardInventory
            initialBaseUrl={masterInspectorConfig.baseUrl}
            initialToken={masterInspectorConfig.token}
            mode="function"
          />
        )}
      </main>
    </div>
  );
}
