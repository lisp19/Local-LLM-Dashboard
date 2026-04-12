import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { MonitoringConfig } from './types';

const DEFAULT_CONFIG: MonitoringConfig = {
  openWebUIPort: 53000,
  vllmApiKey: 'vllm-test',
  pythonPath: '~/miniconda3/envs/kt/bin/python',
  benchmarkPlotDir: '~/.config/kanban/benchmarks',
  dispatchers: {
    system: { enabled: true, intervalMs: 1000, timeoutMs: 1000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
    docker: { enabled: true, intervalMs: 1500, timeoutMs: 2000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
    gpu: { enabled: true, intervalMs: 1500, timeoutMs: 2000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
    modelConfig: { enabled: true, intervalMs: 5000, timeoutMs: 1000, degradeAfterFailures: 2, recoverAfterSuccesses: 1, apiProbeIntervalMs: 10000 },
  },
  agent: {
    allowExternalReport: true,
    reportToken: 'change-me',
  },
  snapshot: {
    maxAgeMs: 5000,
  },
  health: {
    retentionLimit: 200,
  },
};

function getConfigCandidateDirs(): string[] {
  return [
    path.join(os.homedir(), '.config', 'kanban'),
    process.cwd(),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) {
    return (override as T) ?? base;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value;
  }
  return result as T;
}

export async function loadMonitoringConfig(): Promise<MonitoringConfig> {
  for (const dir of getConfigCandidateDirs()) {
    const configPath = path.join(dir, 'config.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      return mergeDeep(DEFAULT_CONFIG, JSON.parse(content));
    } catch {
      continue;
    }
  }

  return { ...DEFAULT_CONFIG };
}

export async function loadModelConfig(): Promise<Record<string, Record<string, string | number | boolean>>> {
  for (const dir of getConfigCandidateDirs()) {
    const configPath = path.join(dir, 'model-config.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      return JSON.parse(content) as Record<string, Record<string, string | number | boolean>>;
    } catch {
      continue;
    }
  }

  return {};
}
