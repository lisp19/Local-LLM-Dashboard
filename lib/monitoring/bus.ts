import type { MetricEnvelope } from './contracts';

type Consumer = (envelope: MetricEnvelope) => void | Promise<void>;

export interface PublishResult {
  sequence: number;
}

export interface QueueStats {
  topicCount: number;
  groupCount: number;
  consumerCount: number;
  pendingDeliveries: number;
  bufferOverwrites: string;
  ackedDeliveries: string;
  timedOutDeliveries: string;
  consumerErrors: string;
}

export interface MessageBus {
  publish(envelope: Omit<MetricEnvelope, 'sequence'>): PublishResult;
  subscribe(topic: string, group: string, consumer: Consumer): () => void;
  getQueueStats(): QueueStats;
}

const RING_BUFFER_SIZE = 64;
const ACK_TIMEOUT_MS = 5000;
const ACK_SWEEP_INTERVAL_MS = 1000;

interface RingBuffer {
  messages: MetricEnvelope[];
  head: number;
  count: number;
}

interface PendingAck {
  topic: string;
  group: string;
  deadlineAt: number;
}

function createRingBuffer(): RingBuffer {
  return { messages: new Array<MetricEnvelope>(RING_BUFFER_SIZE), head: 0, count: 0 };
}

function pushToRing(ring: RingBuffer, msg: MetricEnvelope): boolean {
  const overwrote = ring.count >= RING_BUFFER_SIZE;
  ring.messages[ring.head] = msg;
  ring.head = (ring.head + 1) % RING_BUFFER_SIZE;
  if (!overwrote) ring.count++;
  return overwrote;
}

// GroupKey -> Consumer[]
type GroupConsumers = Map<string, Consumer[]>;

function createAckKey(seq: number, topic: string, group: string): string {
  return `${seq}:${topic}:${group}`;
}

function toCounterString(value: bigint): string {
  return value.toString(10);
}

export function createMessageBus(): MessageBus {
  // topic -> ring buffer
  const rings = new Map<string, RingBuffer>();
  // topic -> (group -> consumers[])
  const subscriptions = new Map<string, GroupConsumers>();
  let sequence = 0;

  // Bigint cumulative counters
  let bufferOverwrites = BigInt(0);
  let ackedDeliveries = BigInt(0);
  let timedOutDeliveries = BigInt(0);
  let consumerErrors = BigInt(0);

  // Pending ack records keyed by "${sequence}:${topic}:${group}"
  const pendingAcks = new Map<string, PendingAck>();

  function markAcked(key: string): void {
    if (!pendingAcks.has(key)) return;
    pendingAcks.delete(key);
    ackedDeliveries += BigInt(1);
  }

  function sweepExpiredAcks(): void {
    const now = Date.now();
    for (const [key, pending] of pendingAcks.entries()) {
      if (pending.deadlineAt <= now) {
        pendingAcks.delete(key);
        timedOutDeliveries += BigInt(1);
      }
    }
  }

  // Background sweep timer - unref'd so it does not hold the process open
  const sweepTimer = setInterval(sweepExpiredAcks, ACK_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

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
      const overwrote = pushToRing(ring, full);
      if (overwrote) bufferOverwrites += BigInt(1);

      const groups = subscriptions.get(envelope.topic);
      if (groups) {
        for (const [group, consumers] of groups.entries()) {
          if (consumers.length === 0) continue;

          const ackKey = createAckKey(seq, envelope.topic, group);
          pendingAcks.set(ackKey, {
            topic: envelope.topic,
            group,
            deadlineAt: Date.now() + ACK_TIMEOUT_MS,
          });

          for (const consumer of consumers) {
            try {
              const result = consumer(full);
              if (result instanceof Promise) {
                result.then(() => markAcked(ackKey)).catch((err) => {
                  consumerErrors += BigInt(1);
                  console.error('[bus] Consumer error:', err);
                });
              } else {
                markAcked(ackKey);
              }
            } catch (err) {
              consumerErrors += BigInt(1);
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
        pendingDeliveries: pendingAcks.size,
        bufferOverwrites: toCounterString(bufferOverwrites),
        ackedDeliveries: toCounterString(ackedDeliveries),
        timedOutDeliveries: toCounterString(timedOutDeliveries),
        consumerErrors: toCounterString(consumerErrors),
      };
    },
  };
}
