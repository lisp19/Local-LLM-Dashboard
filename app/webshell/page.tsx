'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { Button } from 'antd';
import { useSearchParams } from 'next/navigation';
import WebShellContent from '../../components/WebShellContent';

function WebShellPageInner() {
  const searchParams = useSearchParams();
  const handoffId = searchParams.get('handoff');

  return <WebShellContent mode="page" initialHandoffId={handoffId} />;
}

export default function WebShellPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto mb-4 flex max-w-5xl items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">WebShell</h1>
          <p className="text-sm text-slate-400">独立标签页终端视图</p>
        </div>
        <Button>
          <Link href="/">返回 Dashboard</Link>
        </Button>
      </div>

      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl">
        <Suspense fallback={<div className="p-6 text-slate-400">Loading...</div>}>
          <WebShellPageInner />
        </Suspense>
      </div>
    </main>
  );
}
