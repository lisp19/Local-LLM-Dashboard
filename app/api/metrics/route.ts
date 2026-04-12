import { NextResponse } from 'next/server';
import { ensureMonitoringRuntimeStarted, getLegacyDashboardSnapshotOnce } from '../../../lib/monitoring/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureMonitoringRuntimeStarted();
    return NextResponse.json(getLegacyDashboardSnapshotOnce());
  } catch (error) {
    console.error('API Metrics Error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
