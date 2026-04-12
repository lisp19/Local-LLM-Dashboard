import * as os from 'os';
import * as fs from 'fs/promises';
import type { SystemMetrics } from '../contracts';

// Fallback: read /proc/stat and /proc/meminfo directly
async function getCpuUsageFromProc(): Promise<number> {
  try {
    const stat = await fs.readFile('/proc/stat', 'utf-8');
    const line = stat.split('\n')[0];
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] ?? 0;
    const total = parts.reduce((a, b) => a + b, 0);
    return total === 0 ? 0 : Math.round((1 - idle / total) * 10000) / 100;
  } catch {
    return 0;
  }
}

async function getMemFromProc(): Promise<{ total: number; free: number }> {
  try {
    const content = await fs.readFile('/proc/meminfo', 'utf-8');
    const lines = content.split('\n');
    const get = (key: string) => {
      const match = lines.find((l) => l.startsWith(key + ':'));
      return match ? parseInt(match.split(/\s+/)[1] ?? '0', 10) * 1024 : 0;
    };
    return { total: get('MemTotal'), free: get('MemAvailable') };
  } catch {
    return { total: os.totalmem(), free: os.freemem() };
  }
}

async function getOsReleaseFallback(): Promise<string> {
  try {
    const content = await fs.readFile('/etc/os-release', 'utf-8');
    const match = content.match(/PRETTY_NAME="(.+)"/);
    if (match) return match[1];
  } catch {
    // fall through
  }
  return `${os.type()} ${os.release()}`;
}

export async function sampleSystemFallback(): Promise<SystemMetrics> {
  const [cpuUsage, { total: totalMem, free: freeMem }, osRelease] = await Promise.all([
    getCpuUsageFromProc(),
    getMemFromProc(),
    getOsReleaseFallback(),
  ]);

  const cpus = os.cpus();

  return {
    cpuUsage,
    cpuCores: cpus.length,
    cpuModel: cpus[0]?.model ?? 'Unknown CPU',
    osRelease,
    memory: {
      total: totalMem,
      used: totalMem - freeMem,
      free: freeMem,
    },
  };
}
