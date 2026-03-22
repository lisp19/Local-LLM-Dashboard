'use client';
import React, { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Card, Result, Spin, Tag, Progress, Descriptions, Typography, Badge, Modal, Input, Switch, Button, Divider, Space } from 'antd';
import { DesktopOutlined, HddOutlined, AppstoreOutlined, PushpinOutlined, PushpinFilled, PlayCircleOutlined, SettingOutlined } from '@ant-design/icons';
import type { DashboardData } from '../lib/systemMetrics';

const { Title, Text } = Typography;

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [pinnedName, setPinnedName] = useState<string | null>('vllm_qw3');
  
  // Benchmark State
  const [isModalOpen, setIsModalOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [benchmarkContainer, setBenchmarkContainer] = useState<any>(null);
  const [bmPrompt, setBmPrompt] = useState('你好，介绍一下你自己,200字以内');
  const [enableThinking, setEnableThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamOutput, setStreamOutput] = useState('');
  const [ttft, setTtft] = useState<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [decodeTime, setDecodeTime] = useState<number | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleOpenBenchmark = (runtime: any, modelConfig: any) => {
    const portMatch = runtime.ports?.match(/:(\d+)->/);
    const port = portMatch ? portMatch[1] : null;
    
    setBenchmarkContainer({
      id: runtime.id,
      name: runtime.name,
      port: port,
      model: modelConfig?.Model || runtime.name
    });
    setStreamOutput('');
    setTtft(null);
    setTps(null);
    setTokenCount(0);
    setDecodeTime(null);
    setIsModalOpen(true);
  };

  const startBenchmark = async () => {
    if (!benchmarkContainer?.port) {
       setStreamOutput('Error: Unable to parse port from container.');
       return;
    }
    
    setIsStreaming(true);
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
                const reason = json.choices?.[0]?.delta?.reasoning_content;
                const text = content || reason;
                if (text) {
                  setStreamOutput(prev => prev + text);
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
  const { data, error, isLoading, isValidating } = useSWR<DashboardData>('/api/metrics', fetcher, {
    refreshInterval: 2000, // Poll every 2 seconds
    revalidateOnFocus: true,
  });

  useEffect(() => {
    setMounted(true);
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
          <div>
            <Title level={4} style={{ marginBottom: '12px' }}><DesktopOutlined /> Host System & GPUs</Title>
            <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-6 gap-3">
              <Card bordered={false} hoverable style={{ borderRadius: 16 }} styles={{ body: { padding: '14px 16px' } }} className="shadow-sm col-span-1 md:col-span-4 xl:col-span-2">
                <div className="flex justify-between items-baseline mb-1.5">
                  <Text type="secondary" className="block text-sm whitespace-nowrap flex-shrink-0">System</Text>
                  <Text type="secondary" className="text-xs truncate ml-4 text-right" title={data?.system.cpuModel}>{data?.system.cpuModel}</Text>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-slate-500 w-8">CPU</span>
                    <Progress percent={data?.system.cpuUsage} strokeColor="#1677ff" className="flex-grow min-w-0" showInfo={false} />
                    <Text className="w-24 whitespace-nowrap text-right font-medium text-xs text-slate-700">{data?.system.cpuUsage}%</Text>
                  </div>
                  {data && (() => {
                    const { total, used } = data.system.memory;
                    const percent = Math.round((used / total) * 100);
                    return (
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-slate-500 w-8">RAM</span>
                        <Progress percent={percent} strokeColor="#ff4d4f" className="flex-grow min-w-0" showInfo={false} />
                        <Text className="w-24 whitespace-nowrap text-right font-medium text-xs text-slate-700">{(used / 1024 / 1024 / 1024).toFixed(1)} / {(total / 1024 / 1024 / 1024).toFixed(0)} GB</Text>
                      </div>
                    );
                  })()}
                </div>
              </Card>
              
              {data?.gpus.map((gpu) => (
                <Card key={gpu.id} bordered={false} hoverable style={{ borderRadius: 16 }} styles={{ body: { padding: '14px 16px' } }} className="shadow-sm col-span-1 md:col-span-2 xl:col-span-2">
                  <div className="flex justify-between items-start mb-2">
                    <Text type="secondary" className="font-semibold flex-1 mr-2 break-words text-sm leading-tight" title={gpu.name}>GPU {gpu.id}: {gpu.name}</Text>
                    <div className="flex items-center justify-end gap-1.5 flex-shrink-0">
                      <Tag color="geekblue" bordered={false} className="!m-0 font-medium">{gpu.temperature}</Tag>
                      <Tag color="orange" bordered={false} className="!m-0 font-medium">{gpu.powerDraw}W / {gpu.powerLimit}W</Tag>
                    </div>
                  </div>
                  <div className="space-y-2 mt-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1 font-medium"><span>Core</span><span>{gpu.utilization}</span></div>
                      <Progress percent={parseFloat(gpu.utilization)} showInfo={false} strokeColor="#52c41a" size="small" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1 font-medium"><span>VRAM</span><span>{gpu.memoryUsed}</span></div>
                      <Progress percent={Math.round((parseFloat(gpu.memoryUsed) / parseFloat(gpu.memoryTotal)) * 100) || 0} showInfo={false} strokeColor="#ff4d4f" size="small" />
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
              let sortedContainers = data?.containers || [];
              if (pinnedName && sortedContainers.length > 0) {
                const list = [...sortedContainers];
                const pinnedIdx = list.findIndex(c => c.runtime.name === pinnedName);
                if (pinnedIdx > -1) {
                  const [pinned] = list.splice(pinnedIdx, 1);
                  list.unshift(pinned);
                }
                sortedContainers = list;
              }
              
              return (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {sortedContainers.map(({ runtime, modelConfig }) => (
                  <Card key={runtime.id} bordered={false} style={{ borderRadius: 16 }} styles={{ body: { padding: '14px' } }} className={`shadow-sm bg-white transition-shadow ${pinnedName === runtime.name ? 'border-2 border-blue-400 shadow-blue-100' : 'border border-slate-200 hover:shadow-md'}`}>
                    <div className="flex flex-col items-stretch gap-2.5">
                      {/* Runtime Left Panel */}
                      <div className="w-full bg-[#f8fafc] p-4 rounded-xl flex-shrink-0 border border-slate-200 shadow-sm relative">
                        <div className="mb-2">
                          <div className="flex items-center gap-2 mb-0.5">
                            <button
                              onClick={() => setPinnedName(pinnedName === runtime.name ? null : runtime.name)}
                              className="focus:outline-none flex items-center justify-center -ml-1 mr-1"
                              title={pinnedName === runtime.name ? "Unpin container" : "Pin to top"}
                            >
                              {pinnedName === runtime.name ? (
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
                            {pinnedName === runtime.name && <Tag color="blue" bordered={false} className="ml-2 !mr-0 font-medium">Pinned</Tag>}
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
                            {Object.entries(modelConfig)
                              .filter(([k]) => k !== 'Arch' && k !== 'Architecture')
                              .map(([k, v]) => {
                               let content: React.ReactNode = String(v);
                               if (k === 'Runtime') {
                                 const kind = String(v).toLowerCase();
                                 let color = 'default';
                                 if (kind.includes('nvidia') || kind.includes('gpu')) color = 'blue';
                                 else if (kind.includes('rocm') || kind.includes('amd')) color = 'red';
                                 else if (kind.includes('cpu')) color = 'green';
                                 
                                 content = <Tag color={color} bordered={false} className="!m-0 font-medium capitalize">{String(v)}</Tag>;
                               } else if (k === 'Benchmark') {
                                 content = <span className="text-[#1677ff] font-bold text-[14px] bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">{String(v)}</span>;
                               }
                               return (
                                 <Descriptions.Item label={k} key={k} labelStyle={{ color: '#64748b', fontWeight: 500, fontSize: '12px' }}>
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
                ))}
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
           if (!isStreaming) setIsModalOpen(false);
        }}
        footer={null}
        width={700}
        destroyOnClose
      >
        <div className="mb-4">
          <div className="mb-3">
            <Text type="secondary" className="text-xs mb-1 block">Local API Endpoint:</Text>
            <Typography.Paragraph 
              copyable={{ text: `http://127.0.0.1:${benchmarkContainer?.port}/v1` }}
              className="bg-slate-100 p-2 rounded text-xs font-mono text-slate-700 m-0 border border-slate-200"
              style={{ marginBottom: 0 }}
            >
              http://127.0.0.1:{benchmarkContainer?.port}/v1
            </Typography.Paragraph>
          </div>
          <div className="flex items-center justify-between mb-2">
             <Text strong className="text-slate-700">Test Prompt:</Text>
             <Space>
               <Text type="secondary" className="text-xs"><SettingOutlined /> Enable Thinking</Text>
               <Switch size="small" checked={enableThinking} onChange={setEnableThinking} disabled={isStreaming} />
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
        
        <div 
           className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-300 font-mono text-sm leading-relaxed overflow-y-auto whitespace-pre-wrap h-[300px]"
        >
          {streamOutput || <span className="text-slate-600 italic">Waiting for request to start...</span>}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-3 mt-4 bg-blue-50 p-3 rounded-lg border border-blue-100">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-medium mb-1">TTFT</span>
            <span className="text-sm font-semibold text-slate-800">{ttft ? `${ttft.toFixed(3)} s` : '-'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-medium mb-1">Generated</span>
            <span className="text-sm font-semibold text-slate-800">{tokenCount > 0 ? `${tokenCount} tk` : '-'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-medium mb-1">Decode Time</span>
            <span className="text-sm font-semibold text-slate-800">{decodeTime ? `${decodeTime.toFixed(3)} s` : '-'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-medium mb-1">Speed</span>
            <span className="text-sm font-semibold text-blue-600">{tps ? `${tps.toFixed(2)} tk/s` : '-'}</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
