import { NextRequest, NextResponse } from 'next/server';
import { assertAgentToken } from '../../../../lib/monitoring/transport/agentAuth';
import { ensureMonitoringRuntimeStarted } from '../../../../lib/monitoring/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('x-agent-token');
    await assertAgentToken(token);
    const runtime = await ensureMonitoringRuntimeStarted();
    const body = await req.json();
    const events = Array.isArray(body) ? body : [body];
    for (const event of events) runtime.getBus().publish(event);
    return NextResponse.json({ accepted: events.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
