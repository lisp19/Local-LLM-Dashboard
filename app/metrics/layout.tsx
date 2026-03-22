import type { Metadata } from 'next';
import { Suspense } from 'react';
import MetricsPage from './page';

export const metadata: Metadata = {
  title: 'Metrics Viewer | Local Container Monitor',
};

export default function MetricsLayout() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>}>
      <MetricsPage />
    </Suspense>
  );
}
