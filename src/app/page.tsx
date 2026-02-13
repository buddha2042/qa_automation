'use client';

import { useRouter } from 'next/navigation';

export default function QaLandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex flex-col relative overflow-hidden">
      
      {/* Soft Background Accents */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-5%] left-[-5%] w-[40%] h-[40%] bg-blue-100/40 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[10%] right-[10%] w-[30%] h-[30%] bg-indigo-50/40 blur-[100px] rounded-full"></div>
      </div>

      {/* Top Branding Bar */}
      <nav className="w-full border-b border-slate-200 bg-white/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <img 
              src="https://dxc.com/content/dam/dxc/projects/dxc-com/global/logos/dxc/dxc-logo-png-4x.png" 
              alt="DXC Technology" 
              className="h-7 w-auto" 
            />
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

      <div className="max-w-4xl mx-auto w-full px-6 py-12 md:py-16 flex-grow flex flex-col justify-center relative">
        
        {/* REFINED SMALL HEADER */}
        <header className="text-center mb-12">
          {/* Animated Status Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 mb-6 transition-all hover:bg-blue-100/50 cursor-default">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
            </span>
            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">Automation Engine v4.2</span>
          </div>

          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-3 tracking-tight uppercase italic leading-none">
            Data <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-500">Integrity Studio</span>
          </h1>
          
          <p className="text-slate-500 text-sm md:text-base max-w-lg mx-auto font-medium leading-relaxed opacity-80">
            Automated JAQL validation and structural audit reporting <br className="hidden md:block" /> 
            for Sisense and Elasticube environments.
          </p>
        </header>

        {/* Main Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-20">
          
          {/* Compare Widget */}
          <button
            onClick={() => router.push('/widget')}
            className="group relative bg-white border border-slate-200 p-8 rounded-[28px] transition-all hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-100 text-left shadow-sm overflow-hidden"
          >
            <h2 className="text-xl font-black text-slate-900 mb-1 uppercase italic tracking-tight">
              Widget <br/><span className="text-blue-600">Comparison</span>
            </h2>
            <p className="text-[13px] text-slate-400 group-hover:text-slate-600 mb-6 transition-colors font-medium">Verify live JAQL results.</p>
            <div className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-[10px] uppercase transition-all group-hover:scale-105 group-hover:bg-blue-700 shadow-lg shadow-blue-200">
              Launch Audit →
            </div>
          </button>

          {/* View Dashboard */}
          <button
            onClick={() => router.push('/dashfile')}
            className="group relative bg-white border border-slate-200 p-8 rounded-[28px] transition-all hover:border-slate-400 hover:shadow-2xl hover:shadow-slate-200 text-left shadow-sm overflow-hidden"
          >
            <h2 className="text-xl font-black text-slate-900 mb-1 uppercase italic tracking-tight">
              Metadata <br/><span className="text-slate-400">Inspector</span>
            </h2>
            <p className="text-[13px] text-slate-400 group-hover:text-slate-600 mb-6 transition-colors font-medium">Map IDs and JSON layouts.</p>
            <div className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-bold text-[10px] uppercase transition-all group-hover:bg-black shadow-lg shadow-slate-300">
              Open Viewer →
            </div>
          </button>
        </div>

        {/* --- VISUAL DIAGRAM SECTION --- */}
        <section className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <div className="relative flex justify-center mb-12">
            <span className="bg-[#f8fafc] px-8 text-[10px] font-black uppercase tracking-[0.5em] text-slate-400">
              Audit Pipeline
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Step cards are now smaller and more modern */}
            {[
              { title: 'Mapping', desc: 'Sync OIDs & Tokens', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
              { title: 'Sync Fetch', desc: 'Dual-stream Extraction', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
              { title: 'Comparison', desc: 'Recursive JSON Diff', icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2' },
              { title: 'Reporting', desc: 'Excel & Audit Summary', icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', primary: true }
            ].map((step, i) => (
              <div key={i} className="text-center group">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 transition-all shadow-sm ${step.primary ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white border border-slate-200 group-hover:border-blue-400 text-blue-600'}`}>
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

        {/* Simplified Footer */}
        <footer className="mt-20 flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest border-t border-slate-200 pt-8">
          <div className="flex items-center gap-4">
            <span>DXC Technology • 2026</span>
            <span className="text-blue-600 font-black tracking-tighter">v4.2.0-STABLE</span>
          </div>
          <div className="italic font-normal text-slate-300 tracking-tight">Developed by Buddha Kharel</div>
        </footer>
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&display=swap');
        body { font-family: 'Inter', sans-serif; background-color: #f8fafc; }
      `}</style>
    </div>
  );
}