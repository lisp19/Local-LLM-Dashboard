'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Typography, Input, Badge, Spin, Alert, Button, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useSearchParams } from 'next/navigation';

const { Title, Text } = Typography;

interface ParsedMetric {
  name: string;
  help: string;
  type: string;
  samples: { labels: string; value: string; timestamp?: string }[];
}

function parsePrometheusText(text: string): ParsedMetric[] {
  const lines = text.split('\n');
  const metrics: Record<string, ParsedMetric> = {};
  let currentName = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('# HELP ')) {
      const parts = line.slice(7).split(' ');
      currentName = parts[0];
      if (!metrics[currentName]) {
        metrics[currentName] = { name: currentName, help: parts.slice(1).join(' '), type: '', samples: [] };
      } else {
        metrics[currentName].help = parts.slice(1).join(' ');
      }
    } else if (line.startsWith('# TYPE ')) {
      const parts = line.slice(7).split(' ');
      const name = parts[0];
      if (!metrics[name]) metrics[name] = { name, help: '', type: parts[1] || '', samples: [] };
      else metrics[name].type = parts[1] || '';
      currentName = name;
    } else if (!line.startsWith('#')) {
      // sample line
      const spaceIdx = line.lastIndexOf(' ');
      if (spaceIdx === -1) continue;
      const labelPart = line.slice(0, spaceIdx);
      const value = line.slice(spaceIdx + 1);
      // determine metric name vs labels
      const braceIdx = labelPart.indexOf('{');
      const metricName = braceIdx === -1 ? labelPart : labelPart.slice(0, braceIdx);
      const labels = braceIdx === -1 ? '' : labelPart.slice(braceIdx + 1, -1);
      if (!metrics[metricName]) {
        metrics[metricName] = { name: metricName, help: '', type: '', samples: [] };
      }
      metrics[metricName].samples.push({ labels, value });
    }
  }
  return Object.values(metrics);
}

function typeColor(type: string) {
  if (type === 'counter') return 'blue';
  if (type === 'gauge') return 'green';
  if (type === 'histogram') return 'orange';
  if (type === 'summary') return 'purple';
  return 'default';
}

function MetricCard({ metric }: { metric: ParsedMetric }) {
  return (
    <Card
      size="small"
      bordered={false}
      className="shadow-sm border border-slate-200 rounded-lg"
      styles={{ body: { padding: '10px 14px' } }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <Text className="font-mono text-xs font-semibold text-slate-800 break-all">{metric.name}</Text>
        {metric.type && <Tag color={typeColor(metric.type)} bordered={false} className="!text-[10px] !px-1.5 flex-shrink-0">{metric.type}</Tag>}
      </div>
      {metric.help && <Text type="secondary" className="text-xs block mb-2">{metric.help}</Text>}
      <div className="space-y-0.5">
        {metric.samples.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs py-0.5 border-t border-slate-100 first:border-0">
            <Text className="font-mono text-slate-500 text-[11px] truncate">{s.labels || '—'}</Text>
            <Text className="font-mono font-bold text-slate-800 flex-shrink-0">{parseFloat(s.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}</Text>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function MetricsPage() {
  const searchParams = useSearchParams();
  const port = searchParams.get('port') || '';
  const name = searchParams.get('name') || `Port ${port}`;

  const [rawText, setRawText] = useState('');
  const [metrics, setMetrics] = useState<ParsedMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMetrics = useCallback(async () => {
    if (!port) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/proxy-metrics?port=${port}`);
      if (!res.ok) {
        setError(`Error ${res.status}: ${await res.text()}`);
        return;
      }
      const text = await res.text();
      setRawText(text);
      setMetrics(parsePrometheusText(text));
      setLastUpdated(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [port]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const filtered = search
    ? metrics.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.help.toLowerCase().includes(search.toLowerCase()))
    : metrics;

  // Separate vllm-specific from generic
  const vllmMetrics = filtered.filter(m => m.name.startsWith('vllm:'));
  const otherMetrics = filtered.filter(m => !m.name.startsWith('vllm:'));

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => window.history.back()} />
            <div>
              <Title level={3} style={{ margin: 0 }}>Metrics: {name}</Title>
              <Text type="secondary" className="text-sm">
                Prometheus endpoint · Port {port}
                {lastUpdated && ` · Updated ${lastUpdated.toLocaleTimeString()}`}
              </Text>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge status={loading ? 'processing' : error ? 'error' : 'success'} text={loading ? 'Syncing…' : error ? 'Error' : 'Live'} />
            <Button icon={<ReloadOutlined spin={loading} />} onClick={fetchMetrics} disabled={loading}>Refresh</Button>
          </div>
        </div>

        {error && <Alert message={error} type="error" showIcon className="mb-4" />}

        {/* Search Bar + Stats */}
        <div className="flex items-center gap-4 mb-5">
          <Input
            prefix={<SearchOutlined className="text-slate-400" />}
            placeholder="Filter metrics…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            className="max-w-xs"
          />
          <Text type="secondary" className="text-sm">{filtered.length} metrics</Text>
        </div>

        {loading && metrics.length === 0 ? (
          <div className="flex justify-center items-center h-64"><Spin size="large" /></div>
        ) : (
          <>
            {/* vLLM-specific metrics */}
            {vllmMetrics.length > 0 && (
              <div className="mb-8">
                <Title level={5} className="mb-3 text-purple-700">⚡ vLLM Engine Metrics</Title>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {vllmMetrics.map(m => <MetricCard key={m.name} metric={m} />)}
                </div>
              </div>
            )}

            {/* System / other metrics */}
            {otherMetrics.length > 0 && (
              <div>
                <Title level={5} className="mb-3 text-slate-600">🔩 System Metrics</Title>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {otherMetrics.map(m => <MetricCard key={m.name} metric={m} />)}
                </div>
              </div>
            )}
          </>
        )}

        {/* Raw text toggle */}
        <details className="mt-8">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600 select-none">Show raw Prometheus text</summary>
          <pre className="mt-2 bg-slate-900 text-slate-300 text-xs p-4 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap">{rawText}</pre>
        </details>
      </div>
    </div>
  );
}
