'use client';
import React, { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Card, Result, Spin, Tag, Progress, Descriptions, Typography, Badge, Modal, Input, Switch, Button, Divider, Space, Tooltip, Slider, InputNumber, Table, Tabs } from 'antd';
import { DesktopOutlined, HddOutlined, AppstoreOutlined, PushpinOutlined, PushpinFilled, PlayCircleOutlined, SettingOutlined, InfoCircleOutlined, BarChartOutlined } from '@ant-design/icons';
import type { DashboardData, ContainerMetrics } from '../lib/systemMetrics';

interface BenchmarkResult {
  key: number;
  concurrency: number;
  systemTps: string;
  avgTps: string;
  ttft: string;
}

interface BenchmarkContainer {
  id: string;
  name: string;
  port: string | null;
  model: string;
  servedName: string;
  backend: string;
}

const DEFAULT_BENCH_PROMPTS = [
  "Tell me about yourself in 1000 words.",
  "Write a 1000-word essay on high school students in the AI era.",
  "Explain NVLink technology in detail within 1000 words.",
  "Compare pasta and rice for weight loss in 1000 words.",
  "Write a sci-fi short story (1000 words) about landing on Europa.",
  "Explain Quantum Entanglement and its use in 1000 words.",
  "A 1000-word guide for college graduates on job interviews.",
  "Analyze the root causes of the 2008 financial crisis in 1000 words.",
  "Write a 1000-word travelogue about a road trip in Iceland.",
  "Compare Python and C++ memory management in 1000 words.",
  "Discuss Stoicism's core ideas and modern relevance in 1000 words.",
  "Create a 1000-word setting for a medieval Cthulhu-style RPG.",
  "Write a 1000-word film review of Interstellar focusing on visual language.",
  "Describe the process of photosynthesis for high schoolers (1000 words).",
  "A 1000-word marketing plan for a new specialty coffee shop.",
  "A comprehensive 1000-word guide to indoor succulent care and pests."
].join('\n');

const { Title, Text } = Typography;

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function DashboardPage() {
  const { data, error, isLoading, isValidating } = useSWR<DashboardData>('/api/metrics', fetcher, { refreshInterval: 2000 });
  const { data: appConfig } = useSWR('/api/app-config', fetcher);
  const [mounted, setMounted] = useState(false);
  const [hostName, setHostName] = useState('127.0.0.1');
  const [pinnedNames, setPinnedNames] = useState<Set<string>>(new Set(['vllm_qw3']));
  
  const togglePin = (name: string) => {
    setPinnedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  
  // Benchmark State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [benchmarkContainer, setBenchmarkContainer] = useState<BenchmarkContainer | null>(null);
  const [bmPrompt, setBmPrompt] = useState('你好，介绍一下你自己,200字以内');
  const [enableThinking, setEnableThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoningOutput, setReasoningOutput] = useState('');
  const [streamOutput, setStreamOutput] = useState('');
  const [ttft, setTtft] = useState<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [decodeTime, setDecodeTime] = useState<number | null>(null);

  // Concurrency Benchmark State
  const [concurrency, setConcurrency] = useState(1);
  const [benchPrompts, setBenchPrompts] = useState(DEFAULT_BENCH_PROMPTS);
  const [benchReport, setBenchReport] = useState<BenchmarkResult[]>([]);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkImage, setBenchmarkImage] = useState<string | null>(null);
  const [benchmarkMode, setBenchmarkMode] = useState<'python' | 'frontend' | null>(null);
  const [benchmarkLogs, setBenchmarkLogs] = useState('');

  const handleOpenBenchmark = (runtime: ContainerMetrics, modelConfig: Record<string, string | number | boolean> | null) => {
    const portMatch = runtime.ports?.match(/:(\d+)->/);
    const port = portMatch ? portMatch[1] : null;
    
    setBenchmarkContainer({
      id: runtime.id,
      name: runtime.name,
      port: port,
      model: String(modelConfig?.Model || runtime.name),
      servedName: String(modelConfig?.Served_Name || modelConfig?.Model || runtime.name),
      backend: String(modelConfig?.Backend || 'unknown')
    });
    setReasoningOutput('');
    setStreamOutput('');
    setTtft(null);
    setTps(null);
    setTokenCount(0);
    setDecodeTime(null);
    setBenchmarkMode(null);
    setBenchmarkLogs('');
    setIsModalOpen(true);
  };

  const startBenchmark = async () => {
    if (!benchmarkContainer?.port) {
       setStreamOutput('Error: Unable to parse port from container.');
       return;
    }
    
    setIsStreaming(true);
    setReasoningOutput('');
    setStreamOutput('');
    setTtft(null);
    setTps(null);
    setTokenCount(0);
    setDecodeTime(null);

    const startTime = Date.now();
    let firstTokenTime: number | null = null;
    let tokens = 0;

    try {
      const res = await fetch('/api/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: benchmarkContainer.port,
          model: benchmarkContainer.model,
          prompt: bmPrompt.trim(),
          enableThinking: enableThinking
        })
      });

      if (!res.ok) {
         const errText = await res.text();
         setStreamOutput(`Error ${res.status}:\n${errText}`);
         setIsStreaming(false);
         return;
      }

      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const { value, done: readDone } = await reader.read();
        done = readDone;
        if (value) {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
            setTtft((firstTokenTime - startTime) / 1000);
          }
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const content = json.choices?.[0]?.delta?.content;
                const reason = json.choices?.[0]?.delta?.reasoning_content || json.choices?.[0]?.delta?.reasoning || json.choices?.[0]?.delta?.reason;
                if (reason) {
                  setReasoningOutput(prev => prev + reason);
                  tokens++;
                  setTokenCount(tokens);
                }
                if (content) {
                  setStreamOutput(prev => prev + content);
                  tokens++;
                  setTokenCount(tokens);
                }
              } catch {
                // Ignore parse errors from partial JSON
              }
            }
          }
        }
      }
      
      if (firstTokenTime) {
         const dTime = (Date.now() - firstTokenTime) / 1000;
         setDecodeTime(dTime);
         if (dTime > 0) {
           setTps(tokens / dTime);
         }
      }

    } catch (err) {
      setStreamOutput(prev => prev + '\n\nRequest Failed: ' + String(err));
    } finally {
      setIsStreaming(false);
    }
  };

  const runConcurrencyBenchmark = async () => {
    if (!benchmarkContainer?.port) return;
    
    setIsBenchmarking(true);
    setBenchmarkImage(null);
    setBenchmarkLogs('');
    setBenchmarkMode(null);
    const prompts = benchPrompts.split('\n').filter(p => p.trim());
    
    // 1. Try Python Benchmark First (w/ SSE Streaming)
    try {
        setBenchmarkMode('python');
        const pyRes = await fetch('/api/benchmark-python', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                port: benchmarkContainer.port,
                model: benchmarkContainer.servedName,
                concurrency: concurrency,
                prompts: prompts.slice(0, 16),
                runtime: benchmarkContainer.backend?.toLowerCase()?.includes('nvidia') ? 'nvidia' : 
                         (benchmarkContainer.backend?.toLowerCase()?.includes('rocm') || benchmarkContainer.backend?.toLowerCase()?.includes('vulkan')) ? 'amd' : 'cpu'
            })
        });

        if (pyRes.ok && pyRes.body) {
            const reader = pyRes.body.getReader();
            const decoder = new TextDecoder();
            let resultData: { 
                status: string; 
                image?: string; 
                report: Array<{ concurrency: number; system_tps: number; avg_tps: number; avg_ttft: number }>;
            } | null = null;
            let buffer = '';

            // Consume stream
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const packet = JSON.parse(line.slice(6)) as { 
                                type: 'log' | 'result' | 'error'; 
                                content?: string; 
                                data?: { 
                                    status: string; 
                                    image?: string; 
                                    report: Array<{ concurrency: number; system_tps: number; avg_tps: number; avg_ttft: number }>;
                                }; 
                                message?: string; 
                            };
                            if (packet.type === 'log' && packet.content) {
                                setBenchmarkLogs(prev => prev + packet.content);
                            } else if (packet.type === 'result' && packet.data) {
                                resultData = packet.data;
                            } else if (packet.type === 'error') {
                                throw new Error(packet.message || 'Unknown stream error');
                            }
                        } catch (e) {
                            console.error('SSE Parse Error:', e);
                        }
                    }
                }
            }

            if (resultData && resultData.status === 'success') {
                const newResults: BenchmarkResult[] = (resultData.report as Array<{
                    concurrency: number;
                    system_tps: number;
                    avg_tps: number;
                    avg_ttft: number;
                }>).reverse().map((r) => ({
                    key: Date.now() + Math.random(),
                    concurrency: r.concurrency,
                    systemTps: r.system_tps.toFixed(2),
                    avgTps: r.avg_tps.toFixed(2),
                    ttft: r.avg_ttft.toFixed(3)
                }));
                setBenchReport(prev => [...newResults, ...prev]);
                setBenchmarkImage(`/api/benchmark-image?filename=${resultData.image}`);
                setIsBenchmarking(false);
                return;
            }
        }
    } catch (e) {
        console.error('Python benchmark failed, falling back to frontend logic:', e);
        setBenchmarkLogs(prev => prev + `\n[Fallback] Python Suite Failed: ${e instanceof Error ? e.message : String(e)}\nSwitching to Frontend Engine...\n`);
    }

    // 2. Fallback to existing frontend logic
    setBenchmarkMode('frontend');
    const activePrompts = prompts.slice(0, concurrency);
    const startTimeInner = Date.now();
    const portFixed = benchmarkContainer.port;
    const modelFixed = benchmarkContainer.servedName;
    
    const tasks = activePrompts.map(async (p: string) => {
        const sTime = Date.now();
        let fTokenTime: number | null = null;
        let tks = 0;
        try {
            const res = await fetch('/api/benchmark', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    port: portFixed,
                    model: modelFixed,
                    prompt: p.trim(),
                    enableThinking: false
                })
            });
            if (!res.ok || !res.body) return { success: false };
            
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let dLine = false;
            let buffer = '';
            while (!dLine) {
                const { value, done: readDone } = await reader.read();
                dLine = readDone;
                if (value) {
                    if (!fTokenTime) fTokenTime = Date.now();
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (line.trim().startsWith('data: ')) {
                            const d = line.trim().slice(6).trim();
                            if (d && d !== '[DONE]') {
                                try {
                                    const json = JSON.parse(d);
                                    if (json.choices?.[0]?.delta?.content || json.choices?.[0]?.delta?.reasoning_content) {
                                        tks++;
                                    }
                                } catch {}
                            }
                        }
                    }
                }
            }
            const dur = (Date.now() - sTime) / 1000;
            const ttftVal = fTokenTime ? (fTokenTime - sTime) / 1000 : 0;
            return { success: true, tps: tks / dur, ttft: ttftVal, dur: dur, tokens: tks };
        } catch {
            return { success: false };
        }
    });

    const results = await Promise.all(tasks);
    const totalDuration = (Date.now() - startTimeInner) / 1000;
    
    interface TaskResultSuccess { success: true; tps: number; ttft: number; dur: number; tokens: number }
    interface TaskResultFailure { success: false }
    type TaskResult = TaskResultSuccess | TaskResultFailure;

    const success = (results as TaskResult[]).filter((r): r is TaskResultSuccess => r.success);
    const systemTps = success.reduce((acc: number, r: TaskResultSuccess) => acc + r.tokens, 0) / totalDuration;
    const avgTps = success.length > 0 ? success.reduce((acc: number, r: TaskResultSuccess) => acc + r.tps, 0) / success.length : 0;
    const avgTtft = success.length > 0 ? success.reduce((acc: number, r: TaskResultSuccess) => acc + r.ttft, 0) / success.length : 0;

    const newResult: BenchmarkResult = {
        key: Date.now(),
        concurrency: concurrency,
        systemTps: systemTps.toFixed(2),
        avgTps: avgTps.toFixed(2),
        ttft: avgTtft.toFixed(3)
    };

    setBenchReport(prev => [newResult, ...prev]);
    setIsBenchmarking(false);
  };


  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setHostName(window.location.hostname);
    }
  }, []);

  if (!mounted) return null;

  return (
    <div className="min-h-screen p-5 max-w-[1600px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <Title level={2} style={{ margin: 0 }}>Local Container Monitor</Title>
          <Text type="secondary">Real-time local AI inference & container monitoring</Text>
        </div>
        <div className="flex items-center gap-4">
          <Badge status={isValidating ? 'processing' : (error ? 'error' : 'success')} text={isValidating ? 'Syncing' : (error ? 'Error' : 'Live')} className="mr-2" />
          {data && <Text type="secondary">Last updated: {new Date().toLocaleTimeString()}</Text>}
          <Button
            type="primary"
            size="small"
            className="ml-2 shadow-sm"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', border: 'none' }}
            onClick={() => window.open(`http://${hostName}:${appConfig?.openWebUIPort || 53000}`, '_blank')}
            title="Open WebUI"
          >
            💬 Open WebUI
          </Button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="flex justify-center flex-col items-center py-20">
          <Spin size="large" />
          <Text className="mt-4">Loading metrics...</Text>
        </div>
      ) : error ? (
        <Result status="error" title="Failed to load metrics" subTitle={error.message} />
      ) : (
        <>
          {/* System & Global Metrics */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <DesktopOutlined className="text-slate-400" />
              <Title level={5} style={{ margin: 0, fontSize: '14px' }}>Host System & GPUs</Title>
            </div>

            {/* System Header Bar */}
            <Card bordered={false} className="shadow-sm bg-slate-50/50" style={{ borderRadius: 12 }} styles={{ body: { padding: '12px 24px' } }}>
              <div className="flex flex-col lg:flex-row items-center gap-4 lg:gap-0">
                {/* Host Info */}
                <div className="flex items-center gap-3 overflow-hidden flex-shrink-0 w-full lg:w-[25%] lg:pr-6">
                  <div className="bg-blue-100 p-2 rounded-lg flex-shrink-0">
                    <DesktopOutlined className="text-blue-600 text-base" />
                  </div>
                  <div className="min-w-0">
                    <Text strong className="text-[10px] uppercase tracking-wider text-slate-400 block leading-none mb-1">Host</Text>
                    <Text className="text-sm font-semibold truncate block leading-tight text-slate-700" title={data?.system.cpuModel}>{data?.system.cpuModel}</Text>
                  </div>
                </div>

                {/* Vertical Divider */}
                <div className="hidden lg:block w-[1px] h-8 bg-slate-200 mx-0 flex-shrink-0"></div>
                
                {/* CPU Metric */}
                <div className="flex items-center gap-4 flex-1 w-full lg:px-8">
                  <Text className="text-[10px] font-bold text-slate-400 whitespace-nowrap flex-shrink-0">CPU</Text>
                  <div className="flex-grow min-w-0">
                    <Progress percent={data?.system.cpuUsage} strokeColor="#1677ff" showInfo={false} size="small" className="mb-0" />
                  </div>
                  <Text className="text-xs font-mono w-12 text-right flex-shrink-0 text-slate-600">{data?.system.cpuUsage}%</Text>
                </div>

                {/* Vertical Divider */}
                <div className="hidden lg:block w-[1px] h-8 bg-slate-200 mx-0 flex-shrink-0"></div>

                {/* RAM Metric */}
                {data && (() => {
                  const { total, used } = data.system.memory;
                  const percent = Math.round((used / total) * 100);
                  return (
                    <div className="flex items-center gap-4 flex-[1.2] w-full lg:pl-8">
                      <Text className="text-[10px] font-bold text-slate-400 whitespace-nowrap flex-shrink-0">RAM</Text>
                      <div className="flex-grow min-w-0">
                        <Progress percent={percent} strokeColor="#ff4d4f" showInfo={false} size="small" className="mb-0" />
                      </div>
                      <Text className="text-xs font-mono whitespace-nowrap w-28 text-right flex-shrink-0 text-slate-600">
                        {(used / 1024 / 1024 / 1024).toFixed(1)} / {(total / 1024 / 1024 / 1024).toFixed(0)} GB
                      </Text>
                    </div>
                  );
                })()}
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-2">
              
              {data?.gpus.map((gpu) => (
                <Card key={gpu.id} bordered={false} hoverable style={{ borderRadius: 16 }} styles={{ body: { padding: '14px 16px' } }} className="shadow-sm col-span-1">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 mr-2 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Tag 
                          color={gpu.type === 'Nvidia' ? '#76b900' : '#ed1c24'} 
                          bordered={false} 
                          className="!m-0 px-1.5 py-0 text-[10px] font-bold text-white uppercase leading-tight flex-shrink-0"
                          style={{ borderRadius: '4px' }}
                        >
                          {gpu.type}
                        </Tag>
                        <Text type="secondary" className="font-semibold break-words text-sm leading-tight" title={gpu.name}>
                          GPU {gpu.id}
                        </Text>
                      </div>
                      <Text className="text-[11px] text-slate-400 block whitespace-normal break-words" title={gpu.name}>{gpu.name}</Text>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 flex-shrink-0 pt-0.5">
                      <Tag color="geekblue" bordered={false} className="!m-0 font-medium text-[11px]">{gpu.temperature}</Tag>
                      <Tag color="orange" bordered={false} className="!m-0 font-medium text-[11px]">{gpu.powerDraw}W / {gpu.powerLimit}W</Tag>
                    </div>
                  </div>
                  <div className="space-y-2 mt-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1 font-medium"><span>Core</span><span>{gpu.utilization}</span></div>
                      <Progress percent={parseFloat(gpu.utilization)} showInfo={false} strokeColor={gpu.type === 'Nvidia' ? '#76b900' : '#ed1c24'} size="small" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1 font-medium"><span>VRAM</span><span>{gpu.memoryUsed}</span></div>
                      <Progress percent={Math.round((parseFloat(gpu.memoryUsed) / parseFloat(gpu.memoryTotal)) * 100) || 0} showInfo={false} strokeColor={gpu.type === 'Nvidia' ? '#76b900' : '#ed1c24'} size="small" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Containers & Models */}
          <div className="pt-1">
            <Title level={4} style={{ marginBottom: '12px' }}><AppstoreOutlined /> Running Containers</Title>
            {data?.containers.length === 0 ? (
              <Card className="shadow-sm"><div className="text-center py-10 text-gray-400">No Docker containers running.</div></Card>
            ) : (() => {
              const sortedContainers = [...(data?.containers || [])].sort((a, b) => {
                const aPinned = pinnedNames.has(a.runtime.name) || a.modelConfig?.Pinned === true;
                const bPinned = pinnedNames.has(b.runtime.name) || b.modelConfig?.Pinned === true;
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;
                return 0;
              });
              
              return (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {sortedContainers.map(({ runtime, modelConfig }) => {
                    const isPinned = pinnedNames.has(runtime.name) || modelConfig?.Pinned === true;
                    return (
                      <Card key={runtime.id} bordered={false} style={{ borderRadius: 16 }} styles={{ body: { padding: '14px' } }} className={`shadow-sm bg-white transition-shadow ${isPinned ? 'border-2 border-blue-400 shadow-blue-100' : 'border border-slate-200 hover:shadow-md'}`}>
                        <div className="flex flex-col items-stretch gap-2.5">
                          {/* Runtime Left Panel */}
                          <div className="w-full bg-[#f8fafc] p-4 rounded-xl flex-shrink-0 border border-slate-200 shadow-sm relative">
                            <div className="mb-2">
                              <div className="flex items-center gap-2 mb-0.5">
                                <button
                                  onClick={() => togglePin(runtime.name)}
                                  className="focus:outline-none flex items-center justify-center -ml-1 mr-1"
                                  title={isPinned ? "Unpin container" : "Pin to top"}
                                >
                                  {isPinned ? (
                                    <PushpinFilled className="text-blue-500 text-xl drop-shadow-sm" />
                                  ) : (
                                    <PushpinOutlined className="text-slate-400 hover:text-blue-500 text-xl transition-colors" />
                                  )}
                                </button>
                                <Title level={5} style={{ margin: 0, color: '#0f172a' }}>{runtime.name}</Title>
                                <Button 
                                    type="primary"
                                    ghost
                                    size="small" 
                                    icon={<PlayCircleOutlined />} 
                                    className="ml-2 px-2 text-xs font-medium shadow-sm transition-all hover:scale-105" 
                                    onClick={() => handleOpenBenchmark(runtime, modelConfig)}
                                    title="Benchmark & Test API"
                                >
                                    API Test
                                </Button>
                                {(() => {
                                  const portMatch = runtime.ports?.match(/(\d+)->/);                              
                                  const p = portMatch ? portMatch[1] : null;
                                  if (!p) return null;
                                  return (
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<BarChartOutlined />}
                                      className="ml-1 px-1.5 text-slate-400 hover:text-orange-500 hover:bg-orange-50"
                                      title="View Prometheus Metrics Dashboard"
                                      onClick={() => window.open(`/metrics?port=${p}&name=${encodeURIComponent(runtime.name)}`, '_blank')}
                                    />
                                  );
                                })()}
                                {isPinned && <Tag color="blue" bordered={false} className="ml-2 !mr-0 font-medium">Pinned</Tag>}
                                {modelConfig && (modelConfig.Arch || modelConfig.Architecture) && (() => {
                                   const archVal = String(modelConfig.Arch || modelConfig.Architecture);
                                   const isMoe = archVal.toLowerCase().includes('moe');
                                   return <Tag color={isMoe ? 'purple' : 'cyan'} bordered={false} className="ml-2 !mr-0 font-medium">{archVal}</Tag>;
                                })()}
                                <Tag bordered={false} color={runtime.status.includes('Up') ? 'green' : 'red'} className="ml-2">{runtime.status.split(' ')[0]}</Tag>
                                <span className="text-xs font-mono ml-auto text-slate-400">{runtime.id}</span>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
                              <div className="flex flex-col justify-center text-xs">
                                <span className="text-slate-500 mb-0.5">Image</span>
                                <span className="truncate font-medium text-sm text-slate-700" title={runtime.image}>{runtime.image.split('/').pop()}</span>
                              </div>
                              <div className="flex flex-col justify-center text-xs">
                                <span className="text-slate-500 mb-0.5">Ports</span>
                                <span className="truncate font-medium text-sm text-slate-700" title={runtime.ports}>{runtime.ports || 'None'}</span>
                              </div>
                            </div>
    
                            <div className="grid grid-cols-2 gap-4 mt-2">
                              <div>
                                <div className="flex justify-between text-xs mb-1 font-medium"><span className="text-slate-500">CPU</span><span className="text-slate-700">{runtime.cpuPercent}</span></div>
                                <Progress percent={data?.system.cpuCores ? parseFloat(runtime.cpuPercent) / data.system.cpuCores : parseFloat(runtime.cpuPercent)} showInfo={false} size="small" strokeColor="#1677ff" trailColor="#e2e8f0" />
                              </div>
                              <div>
                                <div className="flex justify-between text-xs mb-1 font-medium"><span className="text-slate-500">MEM ({runtime.memUsage})</span></div>
                                <Progress percent={parseFloat(runtime.memUsage.split('/')[0]) ? 50 : 0} showInfo={false} size="small" strokeColor="#52c41a" trailColor="#e2e8f0" status="active" />
                              </div>
                            </div>
                          </div>
                          
                          {/* Model Right Panel */}
                          <div className="w-full p-3 bg-white rounded-xl border border-slate-100">
                            <Title level={5} className="flex items-center gap-2 mb-2 text-sm text-slate-600">
                              <HddOutlined /> Model Configuration
                            </Title>
                            {modelConfig ? (
                              <Descriptions column={4} layout="vertical" bordered size="small" className="bg-white rounded-lg overflow-hidden [&_.ant-descriptions-item-content]:!text-[13px] [&_.ant-descriptions-item-label]:!w-1/4 [&_.ant-descriptions-item]:!pb-2">
                                <Descriptions.Item label="Model" span={4} labelStyle={{ color: '#64748b', fontWeight: 500, fontSize: '12px' }}>
                                  <span className="font-bold text-slate-800">{String(modelConfig.Model || 'Unknown')}</span>
                                </Descriptions.Item>
                                {Object.entries(modelConfig)
                                  .filter(([k]) => k !== 'Model' && k !== 'Arch' && k !== 'Architecture' && k !== 'Pinned')
                                  .map(([k, v]) => {
                                   let content: React.ReactNode = String(v);
                                     if (k === 'Runtime') {
                                       const kind = String(v).toLowerCase();
                                       let color = '#64748b'; // Default grey
                                       if (kind.includes('nvidia')) color = '#76b900';
                                       else if (kind.includes('rocm')) color = '#ed1c24';
                                       else if (kind.includes('vulkan')) color = '#bc13fe';
                                       else if (kind.includes('cpu')) color = '#1677ff';
                                       
                                       content = <Tag color={color} bordered={false} className="!m-0 font-bold text-white" style={{ borderRadius: '4px' }}>{String(v).toUpperCase()}</Tag>;
                                     } else if (k === 'Backend') {
                                     const kind = String(v).toLowerCase();
                                     let color = 'default';
                                     if (kind.includes('vllm')) color = 'purple';
                                     else if (kind.includes('llama.cpp')) color = 'geekblue';
                                     content = <Tag color={color} bordered={false} className="!m-0 font-medium">{String(v)}</Tag>;
                                   } else if (k === 'Benchmark') {
                                     content = <span className="text-[#1677ff] font-bold text-[14px] bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">{String(v)}</span>;
                                   } else if (k === 'Served_Name') {
                                     content = <span className="font-mono text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{String(v)}</span>;
                                   }
                                   return (
                                     <Descriptions.Item label={k === 'Served_Name' ? 'Served Name' : k} key={k} labelStyle={{ color: '#64748b', fontWeight: 500, fontSize: '12px' }}>
                                       {content}
                                     </Descriptions.Item>
                                   );
                                })}
                              </Descriptions>
                            ) : (
                              <div className="flex items-center justify-center min-h-[60px] bg-slate-50 rounded-lg border border-dashed border-slate-200">
                                <span className="text-xs text-slate-400">No configuration found in config for &quot;{runtime.name}&quot;</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </>
      )}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <PlayCircleOutlined className="text-blue-500" />
            <span>Benchmark: {benchmarkContainer?.name}</span>
          </div>
        }
        open={isModalOpen}
        onCancel={() => {
           if (!isStreaming && !isBenchmarking) setIsModalOpen(false);
        }}
        footer={null}
        width={850}
        destroyOnClose
      >
        <Tabs defaultActiveKey="1" items={[
          {
            key: '1',
            label: 'Single Request',
            children: (
              <div className="pt-2">
                <div className="mb-4">
                  <div className="mb-3">
                    <Text type="secondary" className="text-xs mb-1 block">Local API Endpoint:</Text>
                    <Typography.Paragraph 
                      copyable={{ text: `http://${hostName}:${benchmarkContainer?.port}/v1` }}
                      className="bg-slate-100 p-2 rounded text-xs font-mono text-slate-700 m-0 border border-slate-200 break-all"
                    >
                      http://{hostName}:{benchmarkContainer?.port}/v1
                    </Typography.Paragraph>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                     <Text strong className="text-slate-700">Test Prompt:</Text>
                     <Space>
                       <Text type="secondary" className="text-xs">
                         <SettingOutlined /> Enable Thinking
                         {benchmarkContainer?.backend?.toLowerCase()?.includes('llama.cpp') && (
                           <Tooltip title="llama.cpp 后端暂不支持通过客户端请求动态关闭思考过程。"><InfoCircleOutlined className="ml-1 text-slate-400" /></Tooltip>
                         )}
                       </Text>
                       <Switch 
                         size="small" 
                         checked={benchmarkContainer?.backend?.toLowerCase()?.includes('vllm') ? enableThinking : true} 
                         onChange={setEnableThinking} 
                         disabled={isStreaming || !benchmarkContainer?.backend?.toLowerCase()?.includes('vllm')} 
                       />
                     </Space>
                  </div>
                  <Input.TextArea 
                    rows={3} 
                    value={bmPrompt} 
                    onChange={e => setBmPrompt(e.target.value)} 
                    disabled={isStreaming}
                    className="bg-slate-50 mb-3"
                  />
                  <Button type="primary" onClick={startBenchmark} loading={isStreaming} block icon={<PlayCircleOutlined />}>
                     {isStreaming ? 'Running Benchmark...' : 'Start Request'}
                  </Button>
                </div>
        
                <Divider className="my-3 text-slate-400 text-xs text-center" style={{ fontSize: '12px' }}>Output</Divider>
                
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-300 font-mono text-sm leading-relaxed overflow-y-auto h-[250px]">
                  {reasoningOutput && (
                    <details className="mb-3 text-slate-400 bg-slate-800/40 border border-slate-700/50 rounded p-2" open>
                      <summary className="cursor-pointer select-none text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors outline-none">
                        <span className="ml-1 tracking-wider">REASONING PROCESS</span>
                      </summary>
                      <div className="mt-2 text-xs italic whitespace-pre-wrap leading-relaxed border-t border-slate-700/50 pt-2 pb-1">
                        {reasoningOutput}
                      </div>
                    </details>
                  )}
                  <div className="whitespace-pre-wrap">
                    {streamOutput || (!reasoningOutput && <span className="text-slate-600 italic">Waiting for request to start...</span>)}
                  </div>
                </div>
        
                <div className="grid grid-cols-4 gap-3 mt-4 bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 font-medium mb-1">TTFT</span>
                    <span className="text-sm font-semibold text-slate-800">{ttft ? `${ttft.toFixed(3)} s` : '-'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 font-medium mb-1">Tokens</span>
                    <span className="text-sm font-semibold text-slate-800">{tokenCount > 0 ? `${tokenCount} tk` : '-'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 font-medium mb-1">Decode</span>
                    <span className="text-sm font-semibold text-slate-800">{decodeTime ? `${decodeTime.toFixed(2)} s` : '-'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 font-medium mb-1">Speed</span>
                    <span className="text-sm font-semibold text-blue-600">{tps ? `${tps.toFixed(2)} tk/s` : '-'}</span>
                  </div>
                </div>
              </div>
            )
          },
          {
            key: '2',
            label: 'Concurrency Test',
            children: (
              <div className="pt-2">
                <div className="mb-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Text strong>Concurrency (N):</Text>
                      {benchmarkMode && (
                        <Tag 
                          color={benchmarkMode === 'python' ? 'purple' : 'orange'} 
                          bordered={false}
                          className="!m-0 text-[10px] font-bold uppercase"
                          icon={benchmarkMode === 'python' ? <BarChartOutlined /> : <InfoCircleOutlined />}
                        >
                          {benchmarkMode === 'python' ? 'Python Suite' : 'Frontend Fallback'}
                        </Tag>
                      )}
                    </div>
                    <div className="flex items-center gap-4 w-2/3">
                      <Slider 
                        min={1} 
                        max={16} 
                        value={concurrency} 
                        onChange={setConcurrency} 
                        style={{ flex: 1 }}
                        disabled={isBenchmarking}
                      />
                      <InputNumber 
                        min={1} 
                        max={16} 
                        value={concurrency} 
                        onChange={(v) => setConcurrency(v || 1)}
                        disabled={isBenchmarking}
                      />
                    </div>
                  </div>
                  <div className="mb-4">
                    <Text strong className="block mb-2">Prompt List (one per line, first N will be used):</Text>
                    <Input.TextArea 
                      rows={6}
                      value={benchPrompts}
                      onChange={e => setBenchPrompts(e.target.value)}
                      placeholder="Enter prompts here..."
                      disabled={isBenchmarking}
                      className="font-mono text-xs"
                    />
                  </div>
                  <Button 
                    type="primary" 
                    danger={isBenchmarking}
                    onClick={runConcurrencyBenchmark} 
                    loading={isBenchmarking} 
                    block 
                    icon={<BarChartOutlined />}
                  >
                    {isBenchmarking ? 'Running Parallel Requests...' : 'Run Concurrency Test'}
                  </Button>
                </div>

                {benchmarkLogs && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1 px-1">
                      <Text strong className="text-[10px] uppercase tracking-wider text-slate-400">Execution Logs</Text>
                      <Button size="small" type="text" className="text-[10px] h-auto p-0" onClick={() => setBenchmarkLogs('')}>Clear</Button>
                    </div>
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 font-mono text-[10px] text-emerald-400 overflow-y-auto max-h-[160px] leading-relaxed shadow-inner">
                      {benchmarkLogs.split('\n').map((line, i) => (
                        <div key={i} className="min-h-[1.2em]">{line}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mb-2 flex justify-between items-center">
                   <Text strong><BarChartOutlined /> Result History</Text>
                   {benchReport.length > 0 && <Button size="small" onClick={() => setBenchReport([])}>Clear</Button>}
                </div>
                <Table 
                    size="small"
                    dataSource={benchReport}
                    columns={[
                      { title: 'Concur (N)', dataIndex: 'concurrency', key: 'concurrency', width: 120 },
                      { title: 'Sys Total TPS', dataIndex: 'systemTps', key: 'systemTps', render: (val) => <Text strong className="text-blue-600">{val}</Text> },
                      { title: 'Avg TPS', dataIndex: 'avgTps', key: 'avgTps' },
                      { title: 'TTFT (s)', dataIndex: 'ttft', key: 'ttft' },
                    ]}
                    pagination={{ pageSize: 5 }}
                    className="border border-slate-200 rounded-lg overflow-hidden"
                    locale={{ emptyText: 'No benchmark results yet' }}
                />
                
                {benchmarkImage && (
                  <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                      <Text strong className="text-xs text-slate-600"><BarChartOutlined /> Performance Analysis Plot</Text>
                      <Button size="small" type="text" onClick={() => window.open(benchmarkImage, '_blank')}>View Full</Button>
                    </div>
                    <div className="p-2 flex justify-center bg-slate-100">
                      <img src={benchmarkImage} alt="Benchmark Plot" className="max-w-full h-auto rounded shadow-sm" style={{ maxHeight: '400px' }} />
                    </div>
                  </div>
                )}

                <div className="mt-3 bg-orange-50 p-2 rounded border border-orange-100">
                    <Text type="secondary" className="text-[11px]">
                      <InfoCircleOutlined className="mr-1" />
                      Concurrency test sends N requests in parallel. &quot;Sys Total TPS&quot; is the overall throughput of all requests.
                    </Text>
                </div>
              </div>
            )
          }
        ]} />
      </Modal>
    </div>
  );
}
