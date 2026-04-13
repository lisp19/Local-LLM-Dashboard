'use client';
import React from 'react';
import { Badge, Descriptions, Typography } from 'antd';
import type { HealthSnapshot } from '../../lib/monitoring/contracts';

const { Text } = Typography;

// Guard against undefined/null during rolling deployments where the server may
// still be serving the old queue shape (without the new string counter fields).
function isPositiveCounter(value: string | undefined | null): boolean {
  if (value == null) return false;
  try {
    return BigInt(value) > BigInt(0);
  } catch {
    return false;
  }
}

export interface QueueHealthCardProps {
  queue: HealthSnapshot['queue'];
}

export function QueueHealthCard({ queue }: QueueHealthCardProps) {
  // Normalise to '0' if the server hasn't yet been updated to the new shape.
  const bufferOverwrites = (queue.bufferOverwrites as string | undefined) ?? '0';
  const timedOutDeliveries = (queue.timedOutDeliveries as string | undefined) ?? '0';
  const ackedDeliveries = (queue.ackedDeliveries as string | undefined) ?? '0';
  const consumerErrors = (queue.consumerErrors as string | undefined) ?? '0';
  const pendingDeliveries = (queue.pendingDeliveries as number | undefined) ?? 0;

  const hasBufferOverwrites = isPositiveCounter(bufferOverwrites);
  const hasTimedOutDeliveries = isPositiveCounter(timedOutDeliveries);

  return (
    <div className="space-y-3">
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="Topics">{queue.topicCount}</Descriptions.Item>
        <Descriptions.Item label="Subscription Groups">{queue.groupCount}</Descriptions.Item>
        <Descriptions.Item label="Consumers">{queue.consumerCount}</Descriptions.Item>
        <Descriptions.Item label="Pending Deliveries">{pendingDeliveries}</Descriptions.Item>
        <Descriptions.Item label="Buffer Overwrites">
          <Badge status={hasBufferOverwrites ? 'error' : 'success'} text={bufferOverwrites} />
        </Descriptions.Item>
        <Descriptions.Item label="Timed-out Deliveries">
          <Badge status={hasTimedOutDeliveries ? 'error' : 'success'} text={timedOutDeliveries} />
        </Descriptions.Item>
        <Descriptions.Item label="Acked Deliveries">{ackedDeliveries}</Descriptions.Item>
        <Descriptions.Item label="Consumer Errors">{consumerErrors}</Descriptions.Item>
      </Descriptions>
      <Text type="secondary" className="text-xs block">
        Buffer Overwrites tracks retained ring-buffer history pressure. Timed-out Deliveries tracks subscription-group deliveries that did not receive a successful ack before timeout.
      </Text>
    </div>
  );
}
