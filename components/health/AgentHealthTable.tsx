'use client';
import React from 'react';
import { Table, Tag, Typography } from 'antd';
import type { HealthSnapshot } from '../../lib/monitoring/contracts';

const { Text } = Typography;

export interface AgentHealthTableProps {
  agents: HealthSnapshot['agents'];
}

type AgentEntry = HealthSnapshot['agents'][number];

export function AgentHealthTable({ agents }: AgentHealthTableProps) {
  const columns = [
    {
      title: 'Source',
      dataIndex: 'sourceId',
      key: 'sourceId',
      render: (id: string) => <Text code>{id}</Text>,
    },
    {
      title: 'Agent ID',
      dataIndex: 'agentId',
      key: 'agentId',
      render: (id: string) => <Text code>{id}</Text>,
    },
    {
      title: 'Transport',
      dataIndex: 'transport',
      key: 'transport',
      render: (t: string) => (
        <Tag color={t === 'socket.io' ? 'purple' : 'blue'}>{t}</Tag>
      ),
    },
    {
      title: 'Last Seen',
      dataIndex: 'lastSeenAt',
      key: 'lastSeenAt',
      render: (ts: number) => new Date(ts).toLocaleTimeString(),
    },
  ];

  return (
    <Table<AgentEntry>
      dataSource={agents.map((a) => ({ ...a, key: `${a.sourceId}-${a.agentId}` }))}
      columns={columns}
      size="small"
      pagination={false}
      locale={{ emptyText: 'No external agents connected' }}
    />
  );
}
