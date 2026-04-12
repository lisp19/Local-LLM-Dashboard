'use client';
import React from 'react';
import { Typography, Badge, Alert, Card, Spin, Divider, Table } from 'antd';
import Link from 'next/link';
import { useMonitorTransport } from '../../lib/client-monitor/useMonitorTransport';
import { DispatcherHealthTable } from '../../components/health/DispatcherHealthTable';
import { QueueHealthCard } from '../../components/health/QueueHealthCard';
import { AgentHealthTable } from '../../components/health/AgentHealthTable';
import type { HealthSnapshot } from '../../lib/monitoring/contracts';

const { Title, Text } = Typography;

type HealthEvent = HealthSnapshot['events'][number];

export default function HealthPage() {
  const { health, status, error, lastUpdatedAt } = useMonitorTransport();

  const isLoading = status === 'idle' || status === 'loading';

  return (
    <div className="min-h-screen p-5 max-w-[1400px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <Title level={2} style={{ margin: 0 }}>
            Monitoring Health Center
          </Title>
          <Text type="secondary">Read-only view of dispatcher health, message queue, and agent connections</Text>
        </div>
        <div className="flex items-center gap-4">
          <Badge
            status={status === 'live' ? 'success' : status === 'error' ? 'error' : 'processing'}
            text={status === 'live' ? 'Live' : status === 'error' ? 'Error' : 'Connecting'}
          />
          {lastUpdatedAt && (
            <Text type="secondary">Last updated: {new Date(lastUpdatedAt).toLocaleTimeString()}</Text>
          )}
          <Link href="/" className="text-blue-500 hover:underline text-sm">
            ← Back to Dashboard
          </Link>
        </div>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load health data"
          description={error}
          showIcon
        />
      )}

      {isLoading && !health ? (
        <div className="flex justify-center flex-col items-center py-20">
          <Spin size="large" />
          <Text className="mt-4">Loading health snapshot...</Text>
        </div>
      ) : health ? (
        <>
          {/* Dispatchers */}
          <Card
            title="Dispatchers"
            bordered={false}
            className="shadow-sm"
            style={{ borderRadius: 12 }}
          >
            <DispatcherHealthTable dispatchers={health.dispatchers} />
          </Card>

          {/* Message Queue */}
          <Card
            title="Message Queue"
            bordered={false}
            className="shadow-sm"
            style={{ borderRadius: 12 }}
          >
            <QueueHealthCard queue={health.queue} />
          </Card>

          {/* External Agents */}
          <Card
            title="External Agents"
            bordered={false}
            className="shadow-sm"
            style={{ borderRadius: 12 }}
          >
            <AgentHealthTable agents={health.agents} />
          </Card>

          {/* Recent Events */}
          <Card
            title="Recent Events"
            bordered={false}
            className="shadow-sm"
            style={{ borderRadius: 12 }}
          >
            {health.events.length === 0 ? (
              <div className="text-center py-6 text-slate-400">No recent health events</div>
            ) : (
              <Table<HealthEvent>
                dataSource={health.events.map((e, i) => ({ ...e, key: i }))}
                size="small"
                pagination={false}
                columns={[
                  {
                    title: 'Time',
                    dataIndex: 'timestamp',
                    key: 'timestamp',
                    render: (ts: number) => new Date(ts).toLocaleTimeString(),
                  },
                  {
                    title: 'Type',
                    dataIndex: 'type',
                    key: 'type',
                    render: (t: string) => {
                      const color = t === 'recovered' ? 'green' : t === 'degraded' ? 'orange' : 'red';
                      return <span style={{ color, fontWeight: 600 }}>{t}</span>;
                    },
                  },
                  {
                    title: 'Dispatcher',
                    dataIndex: 'dispatcher',
                    key: 'dispatcher',
                  },
                  {
                    title: 'Message',
                    dataIndex: 'message',
                    key: 'message',
                  },
                ]}
              />
            )}
          </Card>

          <Divider />
          <div className="text-center">
            <Text type="secondary" className="text-xs">
              This page is read-only. No operational controls are available here.
            </Text>
          </div>
        </>
      ) : (
        <div className="text-center py-20 text-slate-400">No health snapshot available yet</div>
      )}
    </div>
  );
}
