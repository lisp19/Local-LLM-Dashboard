import { MONITOR_TOPICS } from '../topics';
export function createHealthProjector() {
    const dispatcherMap = new Map();
    const agentMap = new Map();
    const events = [];
    let queueStats = {
        topicCount: 0,
        groupCount: 0,
        consumerCount: 0,
        droppedMessages: 0,
    };
    function addEvent(event, retentionLimit) {
        events.push(event);
        if (events.length > retentionLimit) {
            events.splice(0, events.length - retentionLimit);
        }
    }
    return {
        apply(envelope) {
            var _a;
            if (envelope.topic === MONITOR_TOPICS.healthDispatcher) {
                const state = envelope.payload;
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
                    addEvent({
                        type: state.eventType,
                        dispatcher: state.name,
                        message: (_a = state.message) !== null && _a !== void 0 ? _a : '',
                        timestamp: envelope.timestamp,
                    }, 200);
                }
            }
            else if (envelope.topic === MONITOR_TOPICS.agentReport) {
                const agent = envelope.payload;
                agentMap.set(agent.agentId, {
                    sourceId: agent.sourceId,
                    agentId: agent.agentId,
                    lastSeenAt: envelope.timestamp,
                    transport: agent.transport,
                });
            }
        },
        updateQueueStats(bus) {
            queueStats = bus.getQueueStats();
        },
        getSnapshot() {
            return {
                dispatchers: Array.from(dispatcherMap.values()),
                queue: Object.assign({}, queueStats),
                agents: Array.from(agentMap.values()),
                events: [...events],
            };
        },
    };
}
