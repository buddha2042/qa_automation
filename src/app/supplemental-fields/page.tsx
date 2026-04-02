'use client';

import AppHeader from '@/components/AppHeader';
import SupplementalFieldsWorkspace from '@/components/SupplementalFieldsWorkspace';

export default function SupplementalFieldsPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] text-slate-900">
      <AppHeader
        title="Supplemental Table"
        subtitle="Load a Sisense datamodel, inspect the selected supplemental table, and apply its missing fields with a build."
        backHref="/excel-audit"
      />
      <SupplementalFieldsWorkspace />
    </div>
  );
}
