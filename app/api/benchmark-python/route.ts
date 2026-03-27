import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { getDashboardData } from '../../../lib/systemMetrics';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.join(os.homedir(), '.config/kanban/config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to read config:', e);
  }
  return {};
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { port, model, concurrency, prompts, runtime } = await req.json();
    const config = readConfig();
    const pythonPath = config.pythonPath || '/home/lsp/anaconda3/envs/kt/bin/python';
    const outputDir = config.benchmarkPlotDir || path.join(os.homedir(), '.config/kanban/benchmarks');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const dashboardData = await getDashboardData();
    const cpuInfo = dashboardData.system.cpuCores ? `${dashboardData.system.cpuModel || 'CPU'} (${dashboardData.system.cpuCores} cores)` : 'Unknown CPU';
    const osInfo = dashboardData.system.osRelease || 'Linux';
    
    let gpuInfo = '';
    const gpus = dashboardData.gpus || [];
    if (runtime === 'nvidia') {
      const nGpus = gpus.filter(g => g.name.toLowerCase().includes('nvidia'));
      if (nGpus.length > 0) {
        gpuInfo = `${nGpus.length}x ${nGpus[0].name} (${nGpus[0].memoryTotal})`;
      }
    } else if (runtime === 'rocm' || runtime === 'vulkan') {
      const aGpus = gpus.filter(g => g.name.toLowerCase().includes('amd') || g.name.toLowerCase().includes('radeon'));
      if (aGpus.length > 0) {
        gpuInfo = `${aGpus.length}x ${aGpus[0].name} (${aGpus[0].memoryTotal})`;
      }
    }

    const scriptPath = path.join(process.cwd(), 'scripts/benchmark_script.py');
    const baseUrl = `http://localhost:${port}/v1`;
    const apiKey = config.vllmApiKey || 'vllm-test';

    const args = [
      scriptPath,
      '--base-url', baseUrl,
      '--api-key', apiKey,
      '--model-name', model,
      '--concurrency', String(concurrency),
      '--prompts', JSON.stringify(prompts),
      '--output-dir', outputDir,
      '--cpu-info', cpuInfo,
      '--gpu-info', gpuInfo,
      '--os-info', osInfo
    ];

    console.log('Executing Python Benchmark:', pythonPath, args.join(' '));

    return new Promise<NextResponse>((resolve) => {
      const child = spawn(pythonPath, args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout.trim());
            resolve(NextResponse.json(result));
          } catch {
            resolve(NextResponse.json({ error: 'Failed to parse script output', details: stdout, stderr }, { status: 500 }));
          }
        } else {
          resolve(NextResponse.json({ error: 'Script exited with error', code, stderr, stdout }, { status: 500 }));
        }
      });
    });

  } catch (error) {
    console.error('Python Benchmark API Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
