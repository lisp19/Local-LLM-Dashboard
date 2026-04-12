import { NextResponse } from 'next/server';
import { ensureMonitoringRuntimeStarted, getHealthSnapshotOnce } from '../../../lib/monitoring/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureMonitoringRuntimeStarted();
    return NextResponse.json(getHealthSnapshotOnce());
  } catch (error) {
    console.error('API System-Health Error:', error);
    return NextResponse.json({ error: 'Failed to fetch health snapshot' }, { status: 500 });
  }
}
