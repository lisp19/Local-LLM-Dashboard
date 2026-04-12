import * as os from 'os';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SystemMetrics } from '../contracts';

const execFileAsync = promisify(execFile);

// Track CPU times between samples for usage calculation
let lastCpuTimes: os.CpuInfo['times'][] | null = null;

function computeCpuUsage(): number {
  const cpus = os.cpus();
  if (!lastCpuTimes) {
    lastCpuTimes = cpus.map((c) => ({ ...c.times }));
    return 0;
  }

  let totalDiff = 0;
  let idleDiff = 0;

  for (let i = 0; i < cpus.length; i++) {
    const curr = cpus[i].times;
    const last = lastCpuTimes[i] ?? curr;
    const user = curr.user - last.user;
    const nice = curr.nice - last.nice;
    const sys = curr.sys - last.sys;
    const idle = curr.idle - last.idle;
    const irq = curr.irq - last.irq;
    const total = user + nice + sys + idle + irq;
    totalDiff += total;
    idleDiff += idle;
  }

  lastCpuTimes = cpus.map((c) => ({ ...c.times }));
  return totalDiff === 0 ? 0 : Math.round((100 - (100 * idleDiff) / totalDiff) * 100) / 100;
}

async function getOsRelease(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('lsb_release', ['-ds']);
    if (stdout.trim()) return stdout.trim();
  } catch {
    // fall through
  }
  try {
    const content = await fs.readFile('/etc/os-release', 'utf-8');
    const match = content.match(/PRETTY_NAME="(.+)"/);
    if (match) return match[1];
  } catch {
    // fall through
  }
  return `${os.type()} ${os.release()}`;
}

export async function sampleSystemPrimary(): Promise<SystemMetrics> {
  const cpuUsage = computeCpuUsage();
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const osRelease = await getOsRelease();

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
