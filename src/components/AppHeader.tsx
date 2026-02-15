'use client';

import Link from 'next/link';
import { ArrowLeft, Layers } from 'lucide-react';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  onBackClick?: () => void;
  rightSlot?: React.ReactNode;
}

export default function AppHeader({
  title,
  subtitle,
  backHref = '/',
  onBackClick,
  rightSlot,
}: AppHeaderProps) {
  return (
    <header className="bg-white/90 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {onBackClick ? (
            <button
              onClick={onBackClick}
              className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300"
            >
              <ArrowLeft size={12} />
              Back
            </button>
          ) : (
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300"
            >
              <ArrowLeft size={12} />
              Back
            </Link>
          )}
          <div className="h-6 px-2 rounded bg-slate-900 text-white text-[11px] font-black tracking-widest flex items-center">
            DXC
          </div>
          <Layers className="text-blue-600" size={18} />
          <div className="min-w-0">
            <h1 className="font-black uppercase tracking-tight text-slate-800 text-lg leading-tight truncate">
              {title}
            </h1>
            {subtitle ? <p className="text-[11px] text-slate-500 truncate">{subtitle}</p> : null}
          </div>
        </div>
        {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
      </div>
    </header>
  );
}
