import type {
  MetricEnvelope,
  HealthSnapshot,
  DispatcherState,
  QueueCounterSnapshot,
  QueueHealthSamplePayload,
} from '../contracts';
import { MONITOR_TOPICS } from '../topics';
import type { MessageBus } from '../bus';

export interface HealthProjector {
  apply(envelope: MetricEnvelope): void;
  getSnapshot(): HealthSnapshot;
  updateQueueStats(bus: MessageBus): void;
}

function zeroQueueCounters(): QueueCounterSnapshot {
  return {
    bufferOverwrites: '0',
    ackedDeliveries: '0',
    timedOutDeliveries: '0',
    consumerErrors: '0',
  };
}

export function createHealthProjector(): HealthProjector {
  const dispatcherMap = new Map<string, DispatcherState>();
  const agentMap = new Map<string, HealthSnapshot['agents'][number]>();
  const events: HealthSnapshot['events'] = [];
  let queueStats: HealthSnapshot['queue'] = {
    topicCount: 0,
    groupCount: 0,
    consumerCount: 0,
    pendingDeliveries: 0,
    sampledAt: null,
    sampledDiffCounters: zeroQueueCounters(),
    totalCounters: zeroQueueCounters(),
  };

  function addEvent(event: HealthSnapshot['events'][number], retentionLimit: number) {
    events.push(event);
    if (events.length > retentionLimit) {
      events.splice(0, events.length - retentionLimit);
    }
  }

  return {
    apply(envelope: MetricEnvelope): void {
      if (envelope.topic === MONITOR_TOPICS.healthDispatcher) {
        const state = envelope.payload as DispatcherState & {
          eventType?: 'degraded' | 'recovered' | 'error';
          message?: string;
        };
        dispatcherMap.set(state.name, {
          name: state.name,
          mode: state.mode,
          health: state.health,
          consecutivePrimaryFailures: state.consecutivePrimaryFailures,
          consecutiveFallbackFailures: state.consecutiveFallbackFailures,
          lastSuccessAt: state.lastSuccessAt,
          lastErrorAt: state.lastErrorAt,
          lastErrorMessage: state.lastErrorMessage,
          lastLatencyMs: state.lastLatencyMs,
          intervalMs: state.intervalMs,
        });

        if (state.eventType) {
          addEvent(
            {
              type: state.eventType,
              dispatcher: state.name,
              message: state.message ?? '',
              timestamp: envelope.timestamp,
            },
            200,
          );
        }
      } else if (envelope.topic === MONITOR_TOPICS.agentReport) {
        const agent = envelope.payload as { sourceId: string; agentId: string; transport: 'http' | 'socket.io' };
        agentMap.set(agent.agentId, {
          sourceId: agent.sourceId,
          agentId: agent.agentId,
          lastSeenAt: envelope.timestamp,
          transport: agent.transport,
        });
      } else if (envelope.topic === MONITOR_TOPICS.healthQueue) {
        const payload = envelope.payload as QueueHealthSamplePayload;
        queueStats = {
          ...queueStats,
          ...payload.queueStats,
          sampledAt: payload.sampledAt,
          sampledDiffCounters: payload.sampledDiffCounters,
          totalCounters: payload.totalCounters,
        };
      }
    },

    updateQueueStats(bus: MessageBus): void {
      queueStats = {
        ...queueStats,
        ...bus.getQueueStats(),
        totalCounters: bus.getQueueCounterSnapshot(),
      };
    },

    getSnapshot(): HealthSnapshot {
      return {
        dispatchers: Array.from(dispatcherMap.values()),
        queue: { ...queueStats },
        agents: Array.from(agentMap.values()),
        events: [...events],
      };
    },
  };
}
