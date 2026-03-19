'use client';

import AppHeader from '@/components/AppHeader';
import SmodelCompareWorkspace from '@/components/SmodelCompareWorkspace';

export default function SmodelInspectorPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] text-slate-900">
      <AppHeader
        title="Smodel Inspector"
        subtitle="Compare two Sisense models without switching Audit tabs."
        backHref="/"
      />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <SmodelCompareWorkspace />
      </main>
    </div>
  );
}
