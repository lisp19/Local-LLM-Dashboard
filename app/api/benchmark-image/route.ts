import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.join(os.homedir(), '.config/kanban/config.json');

function getPlotDir() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (config.benchmarkPlotDir) return config.benchmarkPlotDir;
    }
  } catch { }
  return path.join(os.homedir(), '.config/kanban/benchmarks');
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get('filename');

    if (!filename) {
      return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
    }

    const plotDir = getPlotDir();
    const filePath = path.join(plotDir, filename);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    console.error('Benchmark Image API Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
