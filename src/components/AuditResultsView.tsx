'use client';

import { useRouter } from 'next/navigation';

interface ComparisonItem {
  path: string;
  regularValue: any;
  refactorValue: any;
  isMatch: boolean;
}

interface Props {
  regularData: any;
  refactorData: any;
  comparisonReport: ComparisonItem[];
}

export default function AuditResultsView({
  regularData,
  refactorData,
  comparisonReport
}: Props) {
  const router = useRouter();

  const mismatchCount = comparisonReport.filter(r => !r.isMatch).length;

  const exportToExcel = () => {
    const headers = ['Property Path', 'Regular Value', 'Refactor Value', 'Status'];
    const rows = comparisonReport.map(item => [
      item.path,
      JSON.stringify(item.regularValue),
      JSON.stringify(item.refactorValue),
      item.isMatch ? 'MATCH' : 'MISMATCH'
    ]);

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Data_Audit_${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">

      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 py-4 px-8 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-1.5 rounded text-white font-bold text-xs">DXC</div>
            <h1 className="text-xl font-semibold">Data Audit</h1>
          </div>
          <button
            onClick={() => router.push('/widget')}
            className="text-sm font-medium underline text-slate-500 hover:text-slate-800"
          >
            ← Back to Widget QA
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-8">

        {/* Summary */}
        <div className="mb-10 bg-white border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-black mb-1">Audit Summary</h2>
          <p className="text-sm text-slate-500">
            {mismatchCount} mismatches found in {comparisonReport.length} properties
          </p>

          <div className="mt-4">
            {mismatchCount === 0 ? (
              <span className="bg-green-100 text-green-700 px-4 py-1 rounded-full text-xs font-black">
                PASS
              </span>
            ) : (
              <span className="bg-red-100 text-red-700 px-4 py-1 rounded-full text-xs font-black">
                FAIL
              </span>
            )}
          </div>
        </div>

        {/* Audit Table */}
        <div className="bg-white border rounded-xl shadow overflow-hidden mb-12">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h3 className="font-bold">Full Audit Report</h3>
            <button
              onClick={exportToExcel}
              className="text-xs font-bold border px-4 py-2 rounded hover:bg-slate-50"
            >
              Download CSV
            </button>
          </div>

          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b">
                <tr>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Path</th>
                  <th className="p-3 text-left">Regular</th>
                  <th className="p-3 text-left">Refactor</th>
                </tr>
              </thead>
              <tbody>
                {comparisonReport.map((r, i) => (
                  <tr key={i} className={!r.isMatch ? 'bg-red-50/30' : ''}>
                    <td className="p-3 font-black text-[10px]">
                      {r.isMatch ? 'MATCH' : 'DIFF'}
                    </td>
                    <td className="p-3 font-mono break-all">{r.path}</td>
                    <td className="p-3 font-mono break-all">{JSON.stringify(r.regularValue)}</td>
                    <td className="p-3 font-mono break-all">{JSON.stringify(r.refactorValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* JSON Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[{ label: 'Regular', data: regularData }, { label: 'Refactor', data: refactorData }].map(p => (
            <div key={p.label} className="bg-slate-900 text-slate-400 rounded-xl p-4 text-xs font-mono overflow-auto h-[400px]">
              <h4 className="text-white font-bold mb-2">{p.label} JSON</h4>
              <pre>{JSON.stringify(p.data, null, 2)}</pre>
            </div>
          ))}
        </div>

      </main>
    </div>
  );
}
