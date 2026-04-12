'use client';
import React from 'react';
import { Descriptions, Badge } from 'antd';
import type { HealthSnapshot } from '../../lib/monitoring/contracts';

export interface QueueHealthCardProps {
  queue: HealthSnapshot['queue'];
}

export function QueueHealthCard({ queue }: QueueHealthCardProps) {
  const hasDropped = queue.droppedMessages > 0;

  return (
    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="Topics">{queue.topicCount}</Descriptions.Item>
      <Descriptions.Item label="Subscription Groups">{queue.groupCount}</Descriptions.Item>
      <Descriptions.Item label="Consumers">{queue.consumerCount}</Descriptions.Item>
      <Descriptions.Item label="Dropped Messages">
        <Badge
          status={hasDropped ? 'error' : 'success'}
          text={String(queue.droppedMessages)}
        />
      </Descriptions.Item>
    </Descriptions>
  );
}
