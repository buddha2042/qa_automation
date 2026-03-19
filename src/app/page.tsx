'use client';

import { useRouter } from 'next/navigation';
import DxcLogo from '@/components/DxcLogo';

const PIPELINE_STEPS = [
  {
    title: 'Mapping',
    desc: 'Sync OIDs & Tokens',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  },
  {
    title: 'Sync Fetch',
    desc: 'Dual-stream Extraction',
    icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
  },
  {
    title: 'Comparison',
    desc: 'Recursive JSON Diff',
    icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2',
  },
  {
    title: 'Reporting',
    desc: 'CSV & Audit Summary',
    icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    primary: true,
  },
];

interface ActionCardProps {
  title: string;
  highlight?: string;
  highlightColor: string;
  desc: string;
  btnText: string;
  btnColor: string;
  hoverBorder: string;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}

export default function QaLandingPage() {
  const router = useRouter();
  const isAdminEnabled = (process.env.NEXT_PUBLIC_ADMIN ?? 'no').trim().toLowerCase() === 'yes';

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex flex-col relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-5%] left-[-5%] w-[40%] h-[40%] bg-blue-100/40 blur-[120px] rounded-full" />
        <div className="absolute bottom-[10%] right-[10%] w-[30%] h-[30%] bg-indigo-50/40 blur-[100px] rounded-full" />
      </div>

      <nav className="w-full border-b border-slate-200 bg-white/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <DxcLogo width={82} height={22} className="h-6 w-auto" priority />
            <div className="h-4 w-px bg-slate-300 hidden sm:block"></div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hidden sm:block">
              Quality Assurance
            </span>
          </div>
          <div className="bg-blue-600 text-white font-black px-3 py-1 rounded-lg text-[10px] uppercase tracking-widest shadow-lg shadow-blue-200">
            Studio
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto w-full px-6 py-12 md:py-16 flex-grow flex flex-col justify-center relative">
        <header className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 mb-6 transition-all hover:bg-blue-100/50 cursor-default">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
            </span>
            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">
              Automation Engine v4.3
            </span>
          </div>

          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-3 tracking-tight uppercase italic leading-none">
            Data <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-500">Integrity Studio</span>
          </h1>

          <p className="text-slate-500 text-sm md:text-base max-w-lg mx-auto font-medium leading-relaxed opacity-80">
            Automated QA tester and validation inspector for Sisense dashboard and widget environments.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5 mb-20">
          <ActionCard
            title="Master"
            highlight="Informer"
            highlightColor="text-slate-400"
            desc="List dashboards under each environment, including dashboard IDs and widget IDs."
            btnText="Open Viewer"
            btnColor="bg-indigo-600 shadow-indigo-200 hover:bg-indigo-700"
            hoverBorder="hover:border-slate-400 hover:shadow-slate-200"
            onClick={() => router.push('/dashfile')}
          />

          <ActionCard
            title="Smodel"
            highlight="Inspector"
            highlightColor="text-cyan-600"
            desc="Open the Sisense model comparison workspace directly and inspect model differences without leaving the landing page flow."
            btnText="Open Inspector"
            btnColor="bg-cyan-600 shadow-cyan-200 hover:bg-cyan-700"
            hoverBorder="hover:border-cyan-500 hover:shadow-cyan-100"
            onClick={() => router.push('/smodel-inspector')}
          />

          <ActionCard
            title="Dashboard"
            highlight="Inspector"
            highlightColor="text-indigo-600"
            desc="Set dashboard-level credentials and bootstrap the cross-environment comparison run."
            btnText="Start Setup"
            btnColor="bg-indigo-600 shadow-indigo-200 hover:bg-indigo-700"
            hoverBorder="hover:border-indigo-500 hover:shadow-indigo-100"
            onClick={() => router.push('/dashboard')}
          />

          <ActionCard
            title="Widget"
            highlight="Inspector"
            highlightColor="text-blue-600"
            desc="Run widget-level structural compare and continue to data audit output checks."
            btnText="Check Widget"
            btnColor="bg-blue-600 shadow-blue-200 hover:bg-blue-700"
            hoverBorder="hover:border-blue-500 hover:shadow-blue-100"
            onClick={() => router.push('/widget')}
          />

          <ActionCard
            title="Dev"
            highlight="Workspace"
            highlightColor="text-sky-600"
            desc="Open the audit workspace for file compare, widget inventory, function lookup, and table transfer."
            btnText={isAdminEnabled ? 'Open Workspace' : 'Admin Only'}
            btnColor="bg-sky-600 shadow-sky-200 hover:bg-sky-700"
            hoverBorder="hover:border-sky-500 hover:shadow-sky-100"
            onClick={() => router.push('/audit')}
            disabled={!isAdminEnabled}
            disabledTitle={!isAdminEnabled ? 'Admin access required' : undefined}
          />
        </div>

        <section className="relative">
          <div className="relative flex justify-center mb-12">
            <span className="bg-[#f8fafc] px-8 text-[10px] font-black uppercase tracking-[0.5em] text-slate-400">
              Audit Pipeline
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {PIPELINE_STEPS.map((step) => (
              <div key={step.title} className="text-center group">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 transition-all shadow-sm ${
                    step.primary
                      ? 'bg-blue-600 text-white shadow-blue-200'
                      : 'bg-white border border-slate-200 group-hover:border-blue-400 text-blue-600'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={step.icon} />
                  </svg>
                </div>
                <h4 className="text-[10px] font-bold text-slate-900 uppercase mb-0.5">{step.title}</h4>
                <p className="text-[9px] text-slate-400 font-medium leading-tight">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-20 flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest border-t border-slate-200 pt-8">
          <div className="flex items-center gap-4">
            <span>DXC Technology • 2026</span>
            <span className="text-blue-600 font-black tracking-tighter">v4.3.0</span>
          </div>
          <div className="italic font-normal text-slate-300 tracking-tight">Developed by Buddha Kharel</div>
        </footer>
      </main>
    </div>
  );
}

function ActionCard({
  title,
  highlight,
  highlightColor,
  desc,
  btnText,
  btnColor,
  hoverBorder,
  onClick,
  disabled = false,
  disabledTitle,
}: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      className={`group relative bg-white border border-slate-200 p-8 rounded-[28px] transition-all text-left shadow-sm overflow-hidden flex flex-col justify-between ${
        disabled ? 'cursor-not-allowed opacity-65' : `hover:shadow-2xl ${hoverBorder}`
      }`}
    >
      <div>
        <h2 className="text-xl font-black text-slate-900 mb-1 uppercase italic tracking-tight">
          {title}
          {highlight ? (
            <>
              {' '}
              <br />
              <span className={highlightColor}>{highlight}</span>
            </>
          ) : null}
        </h2>
        <p className="text-[13px] text-slate-400 group-hover:text-slate-600 mb-6 transition-colors font-medium">{desc}</p>
      </div>
      <div
        className={`inline-flex items-center gap-2 text-white px-4 py-2 rounded-xl font-bold text-[10px] uppercase shadow-lg w-fit ${
          disabled ? 'bg-slate-400 shadow-slate-200' : `${btnColor} transition-all group-hover:scale-105`
        }`}
      >
        {btnText}
      </div>
    </button>
  );
}
