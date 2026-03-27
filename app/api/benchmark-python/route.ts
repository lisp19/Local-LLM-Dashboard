import { NextRequest } from 'next/server';
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

function expandHome(pathStr: string): string {
  if (pathStr.startsWith('~')) {
    return path.join(os.homedir(), pathStr.slice(1));
  }
  return pathStr;
}

export async function POST(req: NextRequest): Promise<Response> {
  const { port, model, concurrency, prompts, runtime } = await req.json();
  const config = readConfig();
  const pythonPath = expandHome(config.pythonPath || '~/anaconda3/envs/kt/bin/python');
  const outputDir = expandHome(config.benchmarkPlotDir || path.join(os.homedir(), '.config/kanban/benchmarks'));

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dashboardData = await getDashboardData();
  const cpuInfo = dashboardData.system.cpuCores ? `${dashboardData.system.cpuModel || 'CPU'} (${dashboardData.system.cpuCores} cores)` : 'Unknown CPU';
  const osInfo = dashboardData.system.osRelease || 'Linux';
  
  let gpuInfo = '';
  const gpus = (dashboardData.gpus || []).filter(g => {
    const name = g.name.toLowerCase();
    if (runtime === 'nvidia') return name.includes('nvidia') || name.includes('geforce') || name.includes('quadro') || name.includes('tesla') || name.includes('rtx');
    if (runtime === 'rocm' || runtime === 'vulkan') return name.includes('amd') || name.includes('ati') || name.includes('radeon');
    return false;
  });
  const runtimeType = runtime === 'nvidia' ? 'nvidia' : (runtime === 'amd' ? 'amd' : 'cpu');
  if (gpus.length > 0) {
    gpuInfo = `${gpus.length}x ${gpus[0].name} (${gpus[0].memoryTotal})`;
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
    '--os-info', osInfo,
    '--runtime-type', runtimeType
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: 'log', content: `Starting Python Benchmark: ${pythonPath} ${args.slice(1).join(' ')}\n` });

      const child = spawn(pythonPath, args);
      let stdout = '';
      let buffer = '';
      child.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        send({ type: 'log', content: str });

        // Parse lines for incremental results
        buffer += str;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json && json.type === 'incremental_result') {
              send({ type: 'incremental_result', data: json.data });
            }
          } catch {
            // Ignore non-JSON or partial JSON lines
          }
        }
      });

      child.stderr.on('data', (data) => {
        send({ type: 'log', content: data.toString(), isError: true });
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            // Find the last line that is valid JSON
            const lines = stdout.trim().split('\n');
            let result = null;
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    result = JSON.parse(lines[i]);
                    if (result && result.status) break;
                } catch { continue; }
            }
            if (result) {
                send({ type: 'result', data: result as Record<string, unknown> });
            } else {
                send({ type: 'error', message: 'Failed to parse script output', details: stdout });
            }
          } catch {
            send({ type: 'error', message: 'Final processing error' });
          }
        } else {
          send({ type: 'error', message: `Script exited with code ${code}` });
        }
        controller.close();
      });

      child.on('error', (err) => {
        send({ type: 'error', message: err.message });
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
