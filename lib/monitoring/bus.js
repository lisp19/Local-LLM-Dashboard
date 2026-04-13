const RING_BUFFER_SIZE = 64;
function createRingBuffer() {
    return { messages: new Array(RING_BUFFER_SIZE), head: 0, count: 0 };
}
function pushToRing(ring, msg) {
    const dropped = ring.count >= RING_BUFFER_SIZE;
    ring.messages[ring.head] = msg;
    ring.head = (ring.head + 1) % RING_BUFFER_SIZE;
    if (!dropped)
        ring.count++;
    return dropped;
}
export function createMessageBus() {
    // topic -> ring buffer
    const rings = new Map();
    // topic -> (group -> consumers[])
    const subscriptions = new Map();
    let sequence = 0;
    let droppedMessages = 0;
    function getOrCreateRing(topic) {
        let ring = rings.get(topic);
        if (!ring) {
            ring = createRingBuffer();
            rings.set(topic, ring);
        }
        return ring;
    }
    function getOrCreateGroupConsumers(topic) {
        let groups = subscriptions.get(topic);
        if (!groups) {
            groups = new Map();
            subscriptions.set(topic, groups);
        }
        return groups;
    }
    return {
        publish(envelope) {
            const seq = ++sequence;
            const full = Object.assign(Object.assign({}, envelope), { sequence: seq });
            const ring = getOrCreateRing(envelope.topic);
            const dropped = pushToRing(ring, full);
            if (dropped)
                droppedMessages++;
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
                        }
                        catch (err) {
                            console.error('[bus] Consumer error:', err);
                        }
                    }
                }
            }
            return { sequence: seq };
        },
        subscribe(topic, group, consumer) {
            const groups = getOrCreateGroupConsumers(topic);
            let consumers = groups.get(group);
            if (!consumers) {
                consumers = [];
                groups.set(group, consumers);
            }
            consumers.push(consumer);
            return () => {
                var _a;
                const list = (_a = subscriptions.get(topic)) === null || _a === void 0 ? void 0 : _a.get(group);
                if (list) {
                    const idx = list.indexOf(consumer);
                    if (idx !== -1)
                        list.splice(idx, 1);
                }
            };
        },
        getQueueStats() {
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
