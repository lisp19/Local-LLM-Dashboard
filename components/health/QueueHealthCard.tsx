'use client';
import React from 'react';
import { Badge, Descriptions, Tooltip, Typography } from 'antd';
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
  sessionCounters: HealthSnapshot['queue']['sampledDiffCounters'];
}

function renderCounterBadge(sessionValue: string, totalValue: string, status: 'success' | 'error') {
  return (
    <Tooltip title={`Backend total: ${totalValue}`}>
      <Badge status={status} text={sessionValue} />
    </Tooltip>
  );
}

function renderCounterText(sessionValue: string, totalValue: string) {
  return <Tooltip title={`Backend total: ${totalValue}`}>{sessionValue}</Tooltip>;
}

export function QueueHealthCard({ queue, sessionCounters }: QueueHealthCardProps) {
  const bufferOverwrites = sessionCounters.bufferOverwrites ?? '0';
  const timedOutDeliveries = sessionCounters.timedOutDeliveries ?? '0';
  const ackedDeliveries = sessionCounters.ackedDeliveries ?? '0';
  const consumerErrors = sessionCounters.consumerErrors ?? '0';
  const pendingDeliveries = (queue.pendingDeliveries as number | undefined) ?? 0;
  const totalBufferOverwrites = queue.totalCounters?.bufferOverwrites ?? '0';
  const totalTimedOutDeliveries = queue.totalCounters?.timedOutDeliveries ?? '0';
  const totalAckedDeliveries = queue.totalCounters?.ackedDeliveries ?? '0';
  const totalConsumerErrors = queue.totalCounters?.consumerErrors ?? '0';

  const hasBufferOverwrites = isPositiveCounter(bufferOverwrites);
  const hasTimedOutDeliveries = isPositiveCounter(timedOutDeliveries);
  const hasConsumerErrors = isPositiveCounter(consumerErrors);

  return (
    <div className="space-y-3">
      <Descriptions bordered size="small" column={2}>
        <Descriptions.Item label="Topics">{queue.topicCount}</Descriptions.Item>
        <Descriptions.Item label="Subscription Groups">{queue.groupCount}</Descriptions.Item>
        <Descriptions.Item label="Consumers">{queue.consumerCount}</Descriptions.Item>
        <Descriptions.Item label="Pending Deliveries">{pendingDeliveries}</Descriptions.Item>
        <Descriptions.Item label="Buffer Overwrites">
          {renderCounterBadge(bufferOverwrites, totalBufferOverwrites, hasBufferOverwrites ? 'error' : 'success')}
        </Descriptions.Item>
        <Descriptions.Item label="Timed-out Deliveries">
          {renderCounterBadge(timedOutDeliveries, totalTimedOutDeliveries, hasTimedOutDeliveries ? 'error' : 'success')}
        </Descriptions.Item>
        <Descriptions.Item label="Acked Deliveries">
          {renderCounterText(ackedDeliveries, totalAckedDeliveries)}
        </Descriptions.Item>
        <Descriptions.Item label="Consumer Errors">
          {renderCounterBadge(consumerErrors, totalConsumerErrors, hasConsumerErrors ? 'error' : 'success')}
        </Descriptions.Item>
      </Descriptions>
      <Text type="secondary" className="text-xs block">
        Queue counters show counts accumulated since you opened this page. Hover the displayed values to inspect backend cumulative totals. Pending Deliveries remains the live backend in-flight count.
      </Text>
    </div>
  );
}
