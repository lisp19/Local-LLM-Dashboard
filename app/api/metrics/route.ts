import { NextResponse } from 'next/server';
import { DashboardData, getDashboardData } from '../../../lib/systemMetrics';

// Add basic in-memory caching for rate limiting/debouncing
let cachedData: DashboardData | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 1000; // 1 second

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = Date.now();
  if (cachedData && now - lastFetchTime < CACHE_TTL_MS) {
    return NextResponse.json(cachedData);
  }

  try {
    const data = await getDashboardData();
    cachedData = data;
    lastFetchTime = now;
    return NextResponse.json(data);
  } catch (error) {
    console.error('API Metrics Error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
