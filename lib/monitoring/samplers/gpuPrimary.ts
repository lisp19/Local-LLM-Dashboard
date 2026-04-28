import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { GpuMetrics } from '../contracts';
import { runNvidiaSmi } from './nvidiaRunner';

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

async function sampleNvidia(): Promise<GpuMetrics[]> {
  const stdout = await runNvidiaSmi([
    '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed',
    '--format=csv,noheader,nounits',
  ], 'primary');

  const lines = stdout.trim().split('\n');
  return lines
    .map((line) => {
      const parts = line.split(',').map((s) => s.trim());
      return {
        id: parts[0] ?? '',
        name: parts[1] ?? '',
        type: 'Nvidia' as const,
        utilization: parts[2] ? `${parts[2]}%` : '0%',
        memoryUsed: parts[3] ? `${parts[3]} MiB` : '0 MiB',
        memoryTotal: parts[4] ? `${parts[4]} MiB` : '0 MiB',
        temperature: parts[5] ? `${parts[5]} °C` : '-',
        powerDraw: parts[6] ? `${Math.round(parseFloat(parts[6]))}` : '0',
        powerLimit: parts[7] ? `${Math.round(parseFloat(parts[7]))}` : '0',
        fanSpeed: parts[8] && parts[8] !== 'N/A' ? `${parts[8]}%` : '-',
      };
    })
    .filter((g) => g.id);
}

async function sampleAmd(): Promise<GpuMetrics[]> {
  const rocmSmi = await findBinary('rocm-smi', ['/opt/rocm/bin']);
  const [{ stdout: rocmStdout }, { stdout: memStdout }] = await Promise.all([
    execFileAsync(rocmSmi, ['-a', '--json']),
    execFileAsync(rocmSmi, ['--showmeminfo', 'vram', '--json']),
  ]);

  const rocmData = JSON.parse(rocmStdout) as Record<string, Record<string, string>>;
  const memData = JSON.parse(memStdout) as Record<string, Record<string, string>>;
  const gpus: GpuMetrics[] = [];

  for (const key of Object.keys(rocmData)) {
    if (!key.startsWith('card')) continue;
    const id = key.replace('card', '');
    const gpu = rocmData[key] ?? {};
    const mem = memData[key] ?? {};

    gpus.push({
      id,
      name: gpu['Device Name'] ?? gpu['Card Series'] ?? `AMD GPU ${id}`,
      type: 'AMD' as const,
      utilization: gpu['GPU use (%)'] ? `${gpu['GPU use (%)']}%` : '0%',
      memoryUsed: mem['VRAM Total Used Memory (B)']
        ? `${Math.round(parseInt(mem['VRAM Total Used Memory (B)'], 10) / 1024 / 1024)} MiB`
        : '0 MiB',
      memoryTotal: mem['VRAM Total Memory (B)']
        ? `${Math.round(parseInt(mem['VRAM Total Memory (B)'], 10) / 1024 / 1024)} MiB`
        : '0 MiB',
      temperature: gpu['Temperature (Sensor edge) (C)'] ? `${gpu['Temperature (Sensor edge) (C)']} °C` : '-',
      powerDraw: gpu['Current Socket Graphics Package Power (W)']
        ? `${Math.round(parseFloat(gpu['Current Socket Graphics Package Power (W)']))}`
        : '0',
      powerLimit: gpu['Max Graphics Package Power (W)']
        ? `${Math.round(parseFloat(gpu['Max Graphics Package Power (W)']))}`
        : '0',
      fanSpeed: gpu['Fan speed (%)'] ? `${gpu['Fan speed (%)']}%` : '-',
    });
  }

  return gpus;
}

export async function sampleGpuPrimary(): Promise<GpuMetrics[]> {
  const results: GpuMetrics[] = [];

  const [nvidiaResult, amdResult] = await Promise.allSettled([sampleNvidia(), sampleAmd()]);

  if (nvidiaResult.status === 'fulfilled') results.push(...nvidiaResult.value);
  if (amdResult.status === 'fulfilled') results.push(...amdResult.value);

  return results;
}
