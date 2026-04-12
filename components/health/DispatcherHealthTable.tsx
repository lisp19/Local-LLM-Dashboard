'use client';
import React from 'react';
import { Table, Tag, Typography } from 'antd';
import type { DispatcherState } from '../../lib/monitoring/contracts';

const { Text } = Typography;

export interface DispatcherHealthTableProps {
  dispatchers: DispatcherState[];
}

function healthColor(health: string) {
  if (health === 'healthy') return 'green';
  if (health === 'degraded') return 'orange';
  return 'red';
}

function modeColor(mode: string) {
  if (mode === 'primary') return 'blue';
  if (mode === 'fallback') return 'gold';
  return 'default';
}

export function DispatcherHealthTable({ dispatchers }: DispatcherHealthTableProps) {
  const columns = [
    {
      title: 'Dispatcher',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: 'Health',
      dataIndex: 'health',
      key: 'health',
      render: (health: string) => <Tag color={healthColor(health)}>{health}</Tag>,
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      render: (mode: string) => <Tag color={modeColor(mode)}>{mode}</Tag>,
    },
    {
      title: 'Latency',
      dataIndex: 'lastLatencyMs',
      key: 'lastLatencyMs',
      render: (ms: number | null) => (ms !== null ? `${ms} ms` : '-'),
    },
    {
      title: 'Primary Fails',
      dataIndex: 'consecutivePrimaryFailures',
      key: 'consecutivePrimaryFailures',
    },
    {
      title: 'Fallback Fails',
      dataIndex: 'consecutiveFallbackFailures',
      key: 'consecutiveFallbackFailures',
    },
    {
      title: 'Last Error',
      dataIndex: 'lastErrorMessage',
      key: 'lastErrorMessage',
      render: (msg: string | null) =>
        msg ? (
          <Text type="danger" className="text-xs">
            {msg}
          </Text>
        ) : (
          <Text type="secondary" className="text-xs">
            —
          </Text>
        ),
    },
  ];

  return (
    <Table<DispatcherState>
      dataSource={dispatchers.map((d) => ({ ...d, key: d.name }))}
      columns={columns}
      size="small"
      pagination={false}
      locale={{ emptyText: 'No dispatchers registered yet' }}
    />
  );
}
