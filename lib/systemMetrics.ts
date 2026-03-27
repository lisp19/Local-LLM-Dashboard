import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { loadModelConfig } from './appConfig';

const execFileAsync = promisify(execFile);

export interface SystemMetrics {
  cpuUsage: number;
  cpuCores: number;
  cpuModel: string;
  osRelease: string;
  memory: {
    total: number;
    used: number;
    free: number;
  };
}

export interface GpuMetrics {
  id: string;
  name: string;
  type: 'Nvidia' | 'AMD';
  utilization: string;
  memoryUsed: string;
  memoryTotal: string;
  temperature: string;
  powerDraw: string;
  powerLimit: string;
}

export interface ContainerMetrics {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  cpuPercent: string;
  memUsage: string;
  gpus: string[];
}

export interface ModelConfig {
  [containerName: string]: Record<string, string | number | boolean>;
}

export interface DashboardData {
  system: SystemMetrics;
  gpus: GpuMetrics[];
  containers: {
    runtime: ContainerMetrics;
    modelConfig: Record<string, string | number | boolean> | null;
  }[];
}

// OS Metrics
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny: any = globalThis;

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const cpus = os.cpus();
  
  if (!globalAny.lastCpuInfo) {
    globalAny.lastCpuInfo = cpus;
    // ensure a small diff window on first load or HMR reset
    await new Promise(r => setTimeout(r, 200));
  }
  
  const currentCpus = os.cpus();
  let idleDifference = 0;
  let totalDifference = 0;

  for (let i = 0; i < currentCpus.length; i++) {
    const cpu = currentCpus[i];
    const lastCpu = globalAny.lastCpuInfo[i] || cpu;
    const user = cpu.times.user - lastCpu.times.user;
    const nice = cpu.times.nice - lastCpu.times.nice;
    const sys = cpu.times.sys - lastCpu.times.sys;
    const idle = cpu.times.idle - lastCpu.times.idle;
    const irq = cpu.times.irq - lastCpu.times.irq;

    const total = user + nice + sys + idle + irq;
    totalDifference += total;
    idleDifference += idle;
  }

  const cpuUsage = totalDifference === 0 ? 0 : 100 - (100 * idleDifference) / totalDifference;
  globalAny.lastCpuInfo = currentCpus;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let osRelease = os.type() + ' ' + os.release();
  try {
    const { stdout } = await execFileAsync('lsb_release', ['-ds']);
    if (stdout.trim()) osRelease = stdout.trim();
  } catch {
    try {
      const content = await fs.readFile('/etc/os-release', 'utf-8');
      const prettyName = content.match(/PRETTY_NAME="(.+)"/);
      if (prettyName) osRelease = prettyName[1];
    } catch {}
  }

  return {
    cpuUsage: Math.round(cpuUsage * 100) / 100,
    cpuCores: currentCpus.length,
    cpuModel: currentCpus[0]?.model || 'Unknown CPU',
    osRelease,
    memory: {
      total: totalMem,
      used: totalMem - freeMem,
      free: freeMem
    },
  };
}

async function findBinary(name: string, extraPaths: string[] = []): Promise<string> {
  const paths = [...extraPaths, '/usr/local/bin', '/usr/bin', '/bin'];
  for (const p of paths) {
    const fullPath = path.join(p, name);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // Continue
    }
  }
  // Fallback to searching in current PATH
  return name;
}

// GPU Metrics
export async function getGpuMetrics(): Promise<GpuMetrics[]> {
  const gpuMetrics: GpuMetrics[] = [];

  // 1. Try NVIDIA GPUs
  try {
    const nvidiaSmi = await findBinary('nvidia-smi');
    const { stdout } = await execFileAsync(nvidiaSmi, [
      '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit',
      '--format=csv,noheader,nounits'
    ]);

    const lines = stdout.trim().split('\n');
    const nvidiaGpus = lines.map(line => {
      const parts = line.split(',').map(s => s.trim());
      return {
        id: parts[0],
        name: parts[1],
        type: 'Nvidia' as const,
        utilization: parts[2] ? `${parts[2]}%` : '0%',
        memoryUsed: parts[3] ? `${parts[3]} MiB` : '0 MiB',
        memoryTotal: parts[4] ? `${parts[4]} MiB` : '0 MiB',
        temperature: parts[5] ? `${parts[5]} °C` : '-',
        powerDraw: parts[6] ? `${Math.round(parseFloat(parts[6]))}` : '0',
        powerLimit: parts[7] ? `${Math.round(parseFloat(parts[7]))}` : '0',
      };
    }).filter(g => g.id);
    gpuMetrics.push(...nvidiaGpus);
  } catch {
    // Skip if nvidia-smi fails
  }

  // 2. Try AMD GPUs (ROCm)
  try {
    const rocmSmi = await findBinary('rocm-smi', ['/opt/rocm/bin']);
    // Get basic stats and names
    const { stdout: rocmStdout } = await execFileAsync(rocmSmi, ['-a', '--json']);
    const rocmData = JSON.parse(rocmStdout);
    
    // Get precise memory info separately as it's more reliable
    const { stdout: memStdout } = await execFileAsync(rocmSmi, ['--showmeminfo', 'vram', '--json']);
    const memData = JSON.parse(memStdout);

    Object.keys(rocmData).forEach(key => {
      if (key.startsWith('card')) {
        const id = key.replace('card', '');
        const gpu = rocmData[key];
        const mem = memData[key] || {};
        
        gpuMetrics.push({
          id: id,
          name: gpu['Device Name'] || gpu['Card Series'] || `AMD GPU ${id}`,
          type: 'AMD' as const,
          utilization: gpu['GPU use (%)'] ? `${gpu['GPU use (%)']}%` : '0%',
          memoryUsed: mem['VRAM Total Used Memory (B)'] ? `${Math.round(parseInt(mem['VRAM Total Used Memory (B)']) / 1024 / 1024)} MiB` : '0 MiB',
          memoryTotal: mem['VRAM Total Memory (B)'] ? `${Math.round(parseInt(mem['VRAM Total Memory (B)']) / 1024 / 1024)} MiB` : '0 MiB',
          temperature: gpu['Temperature (Sensor edge) (C)'] ? `${gpu['Temperature (Sensor edge) (C)']} °C` : '-',
          powerDraw: gpu['Current Socket Graphics Package Power (W)'] ? `${Math.round(parseFloat(gpu['Current Socket Graphics Package Power (W)']))}` : '0',
          powerLimit: gpu['Max Graphics Package Power (W)'] ? `${Math.round(parseFloat(gpu['Max Graphics Package Power (W)']))}` : '0',
        });
      }
    });
  } catch {
    // Skip if rocm-smi fails or is not present
  }

  return gpuMetrics;
}

// Docker Container Metrics
export async function getDockerContainers(): Promise<ContainerMetrics[]> {
  try {
    // Get base list
    const { stdout: psStdout } = await execFileAsync('docker', ['ps', '--format', '{{json .}}']);
    if (!psStdout.trim()) return [];

    const containers = psStdout.trim().split('\n').map(line => JSON.parse(line));
    
    // Get stats
    const { stdout: statsStdout } = await execFileAsync('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
    const statsLines = statsStdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const statsMap = new Map();
    for (const stat of statsLines) {
      statsMap.set(stat.Container, stat);
    }

    // Inspect each to get GPUs (optional step, parsing HostConfig.DeviceRequests)
    const metrics: ContainerMetrics[] = [];
    for (const c of containers) {
      const containerId = c.ID;
      const stat = statsMap.get(containerId) || {};
      
      const gpus: string[] = [];
      try {
        const { stdout: inspectOut } = await execFileAsync('docker', ['inspect', containerId]);
        const inspectData = JSON.parse(inspectOut)[0];
        const deviceRequests = inspectData?.HostConfig?.DeviceRequests || [];
        for (const req of deviceRequests) {
          if (req.Capabilities && req.Capabilities.some((cap: string[]) => cap.includes('gpu'))) {
            if (req.DeviceIDs && req.DeviceIDs.length > 0) {
                gpus.push(...req.DeviceIDs);
            } else if (req.Count === -1) {
                gpus.push('all');
            } else {
                gpus.push(`${req.Count}`);
            }
          }
        }
      } catch {
        // ignore inspect error
      }

      metrics.push({
        id: containerId,
        name: c.Names,
        image: c.Image,
        status: c.Status,
        ports: c.Ports,
        cpuPercent: stat.CPUPerc || '0.00%',
        memUsage: stat.MemUsage || '0B / 0B',
        gpus: gpus,
      });
    }

    return metrics;
  } catch (err) {
    console.error('Failed to get Docker metrics', err);
    return [];
  }
}

// Removed local getModelConfig in favor of centralized loader

export async function getDashboardData(): Promise<DashboardData> {
  const [system, gpus, containers, modelConfig] = await Promise.all([
    getSystemMetrics(),
    getGpuMetrics(),
    getDockerContainers(),
    loadModelConfig()
  ]);

  const configKeys = Object.keys(modelConfig);
  
  const joinedContainers = containers.map(c => {
    return {
      runtime: c,
      modelConfig: modelConfig[c.name] || null
    };
  });

  // Sort by configKeys index
  joinedContainers.sort((a, b) => {
    const idxA = configKeys.indexOf(a.runtime.name);
    const idxB = configKeys.indexOf(b.runtime.name);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0; // fallback
  });

  return {
    system,
    gpus,
    containers: joinedContainers
  };
}
