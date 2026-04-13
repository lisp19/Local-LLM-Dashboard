'use client';
import React from 'react';
import { Badge, Descriptions, Typography } from 'antd';
import type { HealthSnapshot } from '../../lib/monitoring/contracts';

const { Text } = Typography;

function isPositiveCounter(value: string): boolean {
  return BigInt(value) > BigInt(0);
}

export interface QueueHealthCardProps {
  queue: HealthSnapshot['queue'];
}

export function QueueHealthCard({ queue }: QueueHealthCardProps) {
  const hasBufferOverwrites = isPositiveCounter(queue.bufferOverwrites);
  const hasTimedOutDeliveries = isPositiveCounter(queue.timedOutDeliveries);

  return (
    <div className="space-y-3">
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="Topics">{queue.topicCount}</Descriptions.Item>
        <Descriptions.Item label="Subscription Groups">{queue.groupCount}</Descriptions.Item>
        <Descriptions.Item label="Consumers">{queue.consumerCount}</Descriptions.Item>
        <Descriptions.Item label="Pending Deliveries">{queue.pendingDeliveries}</Descriptions.Item>
        <Descriptions.Item label="Buffer Overwrites">
          <Badge status={hasBufferOverwrites ? 'error' : 'success'} text={queue.bufferOverwrites} />
        </Descriptions.Item>
        <Descriptions.Item label="Timed-out Deliveries">
          <Badge status={hasTimedOutDeliveries ? 'error' : 'success'} text={queue.timedOutDeliveries} />
        </Descriptions.Item>
        <Descriptions.Item label="Acked Deliveries">{queue.ackedDeliveries}</Descriptions.Item>
        <Descriptions.Item label="Consumer Errors">{queue.consumerErrors}</Descriptions.Item>
      </Descriptions>
      <Text type="secondary" className="text-xs block">
        Buffer Overwrites tracks retained ring-buffer history pressure. Timed-out Deliveries tracks subscription-group deliveries that did not receive a successful ack before timeout.
      </Text>
    </div>
  );
}
