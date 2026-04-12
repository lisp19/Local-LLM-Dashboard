import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { GpuMetrics } from '../contracts';

const execFileAsync = promisify(execFile);

async function findBinary(name: string, extraPaths: string[] = []): Promise<string> {
  const paths = [...extraPaths, '/usr/local/bin', '/usr/bin', '/bin'];
  for (const p of paths) {
    const fullPath = path.join(p, name);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // continue
    }
  }
  return name;
}

// Fallback uses narrower/simpler queries that are more compatible
async function sampleNvidiaFallback(): Promise<GpuMetrics[]> {
  const nvidiaSmi = await findBinary('nvidia-smi');
  const { stdout } = await execFileAsync(nvidiaSmi, [
    '--query-gpu=index,name,memory.total,memory.used',
    '--format=csv,noheader,nounits',
  ]);

  const lines = stdout.trim().split('\n');
  return lines
    .map((line) => {
      const parts = line.split(',').map((s) => s.trim());
      return {
        id: parts[0] ?? '',
        name: parts[1] ?? '',
        type: 'Nvidia' as const,
        utilization: '-',
        memoryUsed: parts[3] ? `${parts[3]} MiB` : '0 MiB',
        memoryTotal: parts[2] ? `${parts[2]} MiB` : '0 MiB',
        temperature: '-',
        powerDraw: '-',
        powerLimit: '-',
        fanSpeed: '-',
      };
    })
    .filter((g) => g.id);
}

async function sampleAmdFallback(): Promise<GpuMetrics[]> {
  const rocmSmi = await findBinary('rocm-smi', ['/opt/rocm/bin']);
  const { stdout: memStdout } = await execFileAsync(rocmSmi, ['--showmeminfo', 'vram', '--json']);
  const memData = JSON.parse(memStdout) as Record<string, Record<string, string>>;
  const gpus: GpuMetrics[] = [];

  for (const key of Object.keys(memData)) {
    if (!key.startsWith('card')) continue;
    const id = key.replace('card', '');
    const mem = memData[key] ?? {};
    gpus.push({
      id,
      name: `AMD GPU ${id}`,
      type: 'AMD' as const,
      utilization: '-',
      memoryUsed: mem['VRAM Total Used Memory (B)']
        ? `${Math.round(parseInt(mem['VRAM Total Used Memory (B)'], 10) / 1024 / 1024)} MiB`
        : '0 MiB',
      memoryTotal: mem['VRAM Total Memory (B)']
        ? `${Math.round(parseInt(mem['VRAM Total Memory (B)'], 10) / 1024 / 1024)} MiB`
        : '0 MiB',
      temperature: '-',
      powerDraw: '-',
      powerLimit: '-',
      fanSpeed: '-',
    });
  }

  return gpus;
}

export async function sampleGpuFallback(): Promise<GpuMetrics[]> {
  const results: GpuMetrics[] = [];
  const [nvidiaResult, amdResult] = await Promise.allSettled([sampleNvidiaFallback(), sampleAmdFallback()]);
  if (nvidiaResult.status === 'fulfilled') results.push(...nvidiaResult.value);
  if (amdResult.status === 'fulfilled') results.push(...amdResult.value);
  return results;
}
