import type { MetricEnvelope } from './contracts';

type Consumer = (envelope: MetricEnvelope) => void | Promise<void>;

export interface PublishResult {
  sequence: number;
}

export interface QueueStats {
  topicCount: number;
  groupCount: number;
  consumerCount: number;
  droppedMessages: number;
}

export interface MessageBus {
  publish(envelope: Omit<MetricEnvelope, 'sequence'>): PublishResult;
  subscribe(topic: string, group: string, consumer: Consumer): () => void;
  getQueueStats(): QueueStats;
}

const RING_BUFFER_SIZE = 64;

interface RingBuffer {
  messages: MetricEnvelope[];
  head: number;
  count: number;
}

function createRingBuffer(): RingBuffer {
  return { messages: new Array<MetricEnvelope>(RING_BUFFER_SIZE), head: 0, count: 0 };
}

function pushToRing(ring: RingBuffer, msg: MetricEnvelope): boolean {
  const dropped = ring.count >= RING_BUFFER_SIZE;
  ring.messages[ring.head] = msg;
  ring.head = (ring.head + 1) % RING_BUFFER_SIZE;
  if (!dropped) ring.count++;
  return dropped;
}

// GroupKey -> Consumer[]
type GroupConsumers = Map<string, Consumer[]>;

export function createMessageBus(): MessageBus {
  // topic -> ring buffer
  const rings = new Map<string, RingBuffer>();
  // topic -> (group -> consumers[])
  const subscriptions = new Map<string, GroupConsumers>();
  let sequence = 0;
  let droppedMessages = 0;

  function getOrCreateRing(topic: string): RingBuffer {
    let ring = rings.get(topic);
    if (!ring) {
      ring = createRingBuffer();
      rings.set(topic, ring);
    }
    return ring;
  }

  function getOrCreateGroupConsumers(topic: string): GroupConsumers {
    let groups = subscriptions.get(topic);
    if (!groups) {
      groups = new Map<string, Consumer[]>();
      subscriptions.set(topic, groups);
    }
    return groups;
  }

  return {
    publish(envelope: Omit<MetricEnvelope, 'sequence'>): PublishResult {
      const seq = ++sequence;
      const full: MetricEnvelope = { ...envelope, sequence: seq } as MetricEnvelope;
      const ring = getOrCreateRing(envelope.topic);
      const dropped = pushToRing(ring, full);
      if (dropped) droppedMessages++;

      // Broadcast to all groups, all consumers within each group
      const groups = subscriptions.get(envelope.topic);
      if (groups) {
        for (const consumers of groups.values()) {
          for (const consumer of consumers) {
            try {
              const result = consumer(full);
              if (result instanceof Promise) {
                result.catch((err) => console.error('[bus] Consumer error:', err));
              }
            } catch (err) {
              console.error('[bus] Consumer error:', err);
            }
          }
        }
      }

      return { sequence: seq };
    },

    subscribe(topic: string, group: string, consumer: Consumer): () => void {
      const groups = getOrCreateGroupConsumers(topic);
      let consumers = groups.get(group);
      if (!consumers) {
        consumers = [];
        groups.set(group, consumers);
      }
      consumers.push(consumer);

      return () => {
        const list = subscriptions.get(topic)?.get(group);
        if (list) {
          const idx = list.indexOf(consumer);
          if (idx !== -1) list.splice(idx, 1);
        }
      };
    },

    getQueueStats(): QueueStats {
      let groupCount = 0;
      let consumerCount = 0;
      for (const groups of subscriptions.values()) {
        groupCount += groups.size;
        for (const consumers of groups.values()) {
          consumerCount += consumers.length;
        }
      }
      return {
        topicCount: rings.size,
        groupCount,
        consumerCount,
        droppedMessages,
      };
    },
  };
}
