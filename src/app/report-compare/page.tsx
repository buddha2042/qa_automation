'use client';

import AppHeader from '@/components/AppHeader';
import ReportCompareWorkspace from '@/components/ReportCompareWorkspace';

export default function ReportComparePage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)] text-slate-900">
      <AppHeader
        title="Report Compare"
        subtitle="Compare SAPBI exports against vendor files or connected Sisense widget data."
        backHref="/"
      />

      <ReportCompareWorkspace />
    </div>
  );
}
