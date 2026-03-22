import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const port = req.nextUrl.searchParams.get('port');
  if (!port) {
    return new Response('Missing port parameter', { status: 400 });
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { 'Accept': 'text/plain' },
      cache: 'no-store'
    });
    if (!res.ok) {
      return new Response(`Container returned ${res.status}`, { status: res.status });
    }
    const text = await res.text();
    return new Response(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } catch (err) {
    return new Response(`Failed to fetch metrics: ${String(err)}`, { status: 502 });
  }
}
