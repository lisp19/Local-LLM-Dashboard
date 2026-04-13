"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/webshell-tokens.js
var require_webshell_tokens = __commonJS({
  "lib/webshell-tokens.js"(exports2, module2) {
    "use strict";
    var GLOBAL_KEY = "__WEBSHELL_TOKENS__";
    if (!global[GLOBAL_KEY]) {
      global[GLOBAL_KEY] = /* @__PURE__ */ new Map();
    }
    var validTokens = global[GLOBAL_KEY];
    var TOKEN_TTL_MS = 5 * 60 * 1e3;
    function issueToken(token, ttl) {
      validTokens.set(token, Date.now() + (ttl || TOKEN_TTL_MS));
    }
    function consumeToken2(token) {
      const expiry = validTokens.get(token);
      if (!expiry) return false;
      if (Date.now() > expiry) {
        validTokens.delete(token);
        return false;
      }
      validTokens.delete(token);
      return true;
    }
    function cleanupExpired() {
      const now = Date.now();
      for (const [t, expiry] of validTokens.entries()) {
        if (now > expiry) validTokens.delete(t);
      }
    }
    module2.exports = { issueToken, consumeToken: consumeToken2, cleanupExpired };
  }
});

// server.ts
var import_http = require("http");
var import_url = require("url");
var import_next = __toESM(require("next"));
var import_socket = require("socket.io");
var import_ssh2 = require("ssh2");
var import_fs = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
var import_webshell_tokens = __toESM(require_webshell_tokens());

// lib/monitoring/bus.ts
var RING_BUFFER_SIZE = 64;
function createRingBuffer() {
  return { messages: new Array(RING_BUFFER_SIZE), head: 0, count: 0 };
}
function pushToRing(ring, msg) {
  const dropped = ring.count >= RING_BUFFER_SIZE;
  ring.messages[ring.head] = msg;
  ring.head = (ring.head + 1) % RING_BUFFER_SIZE;
  if (!dropped) ring.count++;
  return dropped;
}
function createMessageBus() {
  const rings = /* @__PURE__ */ new Map();
  const subscriptions = /* @__PURE__ */ new Map();
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
      groups = /* @__PURE__ */ new Map();
      subscriptions.set(topic, groups);
    }
    return groups;
  }
  return {
    publish(envelope) {
      const seq = ++sequence;
      const full = { ...envelope, sequence: seq };
      const ring = getOrCreateRing(envelope.topic);
      const dropped = pushToRing(ring, full);
      if (dropped) droppedMessages++;
      const groups = subscriptions.get(envelope.topic);
      if (groups) {
        for (const consumers of groups.values()) {
          for (const consumer of consumers) {
            try {
              const result = consumer(full);
              if (result instanceof Promise) {
                result.catch((err) => console.error("[bus] Consumer error:", err));
              }
            } catch (err) {
              console.error("[bus] Consumer error:", err);
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
        const list = subscriptions.get(topic)?.get(group);
        if (list) {
          const idx = list.indexOf(consumer);
          if (idx !== -1) list.splice(idx, 1);
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
        droppedMessages
      };
    }
  };
}

// lib/monitoring/topics.ts
var MONITOR_TOPICS = {
  metricsSystem: "metrics.system",
  metricsDocker: "metrics.docker",
  metricsGpu: "metrics.gpu",
  configModel: "config.model",
  healthDispatcher: "health.dispatcher",
  healthQueue: "health.queue",
  agentReport: "agent.report"
};
var SUBSCRIPTION_GROUPS = {
  snapshotCore: "snapshot-core",
  snapshotHealth: "snapshot-health",
  wsBroadcast: "ws-broadcast",
  healthCenter: "health-center"
};

// lib/monitoring/projectors/coreProjector.ts
var DEFAULT_SYSTEM = {
  cpuUsage: 0,
  cpuCores: 0,
  cpuModel: "Unknown",
  osRelease: "Unknown",
  memory: { total: 0, used: 0, free: 0 }
};
function createCoreProjector() {
  let system = DEFAULT_SYSTEM;
  let gpus = [];
  let containers = [];
  let modelConfig = {};
  let updatedAt = 0;
  function buildDashboard() {
    const configKeys = Object.keys(modelConfig);
    const joinedContainers = containers.map((runtime) => ({
      runtime,
      modelConfig: modelConfig[runtime.name] ?? null
    }));
    joinedContainers.sort((a, b) => {
      const idxA = configKeys.indexOf(a.runtime.name);
      const idxB = configKeys.indexOf(b.runtime.name);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });
    return { system, gpus, containers: joinedContainers };
  }
  return {
    apply(envelope) {
      switch (envelope.topic) {
        case MONITOR_TOPICS.metricsSystem:
          system = envelope.payload;
          break;
        case MONITOR_TOPICS.metricsGpu:
          gpus = envelope.payload;
          break;
        case MONITOR_TOPICS.metricsDocker:
          containers = envelope.payload;
          break;
        case MONITOR_TOPICS.configModel:
          modelConfig = envelope.payload;
          break;
        default:
          return;
      }
      updatedAt = Date.now();
    },
    getSnapshot() {
      return { dashboard: buildDashboard(), updatedAt };
    }
  };
}

// lib/monitoring/projectors/healthProjector.ts
function createHealthProjector() {
  const dispatcherMap = /* @__PURE__ */ new Map();
  const agentMap = /* @__PURE__ */ new Map();
  const events = [];
  let queueStats = {
    topicCount: 0,
    groupCount: 0,
    consumerCount: 0,
    droppedMessages: 0
  };
  function addEvent(event, retentionLimit) {
    events.push(event);
    if (events.length > retentionLimit) {
      events.splice(0, events.length - retentionLimit);
    }
  }
  return {
    apply(envelope) {
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
          intervalMs: state.intervalMs
        });
        if (state.eventType) {
          addEvent(
            {
              type: state.eventType,
              dispatcher: state.name,
              message: state.message ?? "",
              timestamp: envelope.timestamp
            },
            200
          );
        }
      } else if (envelope.topic === MONITOR_TOPICS.agentReport) {
        const agent = envelope.payload;
        agentMap.set(agent.agentId, {
          sourceId: agent.sourceId,
          agentId: agent.agentId,
          lastSeenAt: envelope.timestamp,
          transport: agent.transport
        });
      }
    },
    updateQueueStats(bus) {
      queueStats = bus.getQueueStats();
    },
    getSnapshot() {
      return {
        dispatchers: Array.from(dispatcherMap.values()),
        queue: { ...queueStats },
        agents: Array.from(agentMap.values()),
        events: [...events]
      };
    }
  };
}

// lib/monitoring/dispatchers/createDispatcher.ts
var import_crypto = require("crypto");
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
function createDispatcher(deps) {
  const { name, topic, metricKey, config, sourceId, agentId, primary, fallback, publish, publishHealth } = deps;
  const state = {
    name,
    mode: "primary",
    health: "healthy",
    consecutivePrimaryFailures: 0,
    consecutiveFallbackFailures: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    lastLatencyMs: null,
    intervalMs: config.intervalMs
  };
  let timer = null;
  let probeTimer = null;
  let running = false;
  let errorCount = 0;
  function buildEnvelope(payload, mode, latencyMs) {
    return {
      id: (0, import_crypto.randomUUID)(),
      topic,
      metricKey,
      sourceId,
      agentId,
      producerId: name,
      timestamp: Date.now(),
      payload,
      meta: {
        mode,
        latencyMs,
        sampleWindowMs: config.intervalMs,
        degraded: state.health === "degraded",
        errorCount,
        schemaVersion: 1
      }
    };
  }
  async function runCycle() {
    if (!config.enabled) return;
    const start = Date.now();
    if (state.health === "degraded") {
      try {
        const payload2 = await withTimeout(fallback(), config.timeoutMs);
        const latencyMs = Date.now() - start;
        state.lastSuccessAt = Date.now();
        state.lastLatencyMs = latencyMs;
        state.consecutiveFallbackFailures = 0;
        publish(buildEnvelope(payload2, "fallback", latencyMs));
        publishHealth(state);
      } catch (err) {
        state.lastErrorAt = Date.now();
        state.lastErrorMessage = err instanceof Error ? err.message : String(err);
        state.consecutiveFallbackFailures++;
        errorCount++;
        if (state.consecutiveFallbackFailures >= config.degradeAfterFailures) {
          state.health = "failed";
          publishHealth(state, "error", state.lastErrorMessage ?? void 0);
        } else {
          publishHealth(state, "error", state.lastErrorMessage ?? void 0);
        }
      }
      return;
    }
    let primaryError = null;
    let payload = null;
    let usedMode = "primary";
    try {
      payload = await withTimeout(primary(), config.timeoutMs);
      const latencyMs = Date.now() - start;
      state.consecutivePrimaryFailures = 0;
      state.lastSuccessAt = Date.now();
      state.lastLatencyMs = latencyMs;
      publish(buildEnvelope(payload, "primary", latencyMs));
      publishHealth(state);
      return;
    } catch (err) {
      primaryError = err instanceof Error ? err : new Error(String(err));
      state.consecutivePrimaryFailures++;
      errorCount++;
    }
    try {
      payload = await withTimeout(fallback(), config.timeoutMs);
      usedMode = "fallback";
      const latencyMs = Date.now() - start;
      state.lastSuccessAt = Date.now();
      state.lastLatencyMs = latencyMs;
      state.consecutiveFallbackFailures = 0;
      publish(buildEnvelope(payload, usedMode, latencyMs));
      if (state.consecutivePrimaryFailures >= config.degradeAfterFailures) {
        state.health = "degraded";
        state.mode = "fallback";
        publishHealth(state, "degraded", `Primary failed ${state.consecutivePrimaryFailures} times, entering degraded mode`);
      } else {
        publishHealth(state, "error", primaryError?.message ?? "Primary failed");
      }
    } catch (fallbackErr) {
      state.lastErrorAt = Date.now();
      state.lastErrorMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      state.consecutiveFallbackFailures++;
      errorCount++;
      publishHealth(state, "error", `Primary: ${primaryError?.message ?? "?"}, Fallback: ${state.lastErrorMessage}`);
    }
  }
  async function probeRecovery() {
    if (state.health !== "degraded" || !running) return;
    try {
      const payload = await withTimeout(primary(), config.timeoutMs);
      const latencyMs = Date.now() - Date.now();
      state.consecutivePrimaryFailures = 0;
      state.lastSuccessAt = Date.now();
      state.lastLatencyMs = latencyMs;
      const prevHealth = state.health;
      if (prevHealth === "degraded") {
        state.health = "healthy";
        state.mode = "primary";
        publishHealth(state, "recovered", "Primary sampler recovered");
        publish(buildEnvelope(payload, "primary", latencyMs));
      }
    } catch {
    }
  }
  function scheduleNext() {
    if (!running) return;
    timer = setTimeout(async () => {
      await runCycle();
      scheduleNext();
    }, config.intervalMs);
  }
  function scheduleProbe() {
    if (!running) return;
    probeTimer = setTimeout(async () => {
      if (state.health === "degraded") {
        await probeRecovery();
      }
      scheduleProbe();
    }, config.apiProbeIntervalMs);
  }
  return {
    start() {
      if (running) return;
      running = true;
      runCycle().then(() => scheduleNext()).catch(() => scheduleNext());
      scheduleProbe();
    },
    async stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (probeTimer) {
        clearTimeout(probeTimer);
        probeTimer = null;
      }
    },
    getState() {
      return { ...state };
    }
  };
}
function makePublishHealth(publish, sourceId, agentId) {
  return (state, eventType, message) => {
    publish({
      id: (0, import_crypto.randomUUID)(),
      topic: MONITOR_TOPICS.healthDispatcher,
      metricKey: "dispatcher.state",
      sourceId,
      agentId,
      producerId: state.name,
      timestamp: Date.now(),
      sequence: 0,
      payload: { ...state, eventType, message },
      meta: {
        mode: state.mode,
        latencyMs: state.lastLatencyMs ?? 0,
        sampleWindowMs: state.intervalMs,
        degraded: state.health === "degraded",
        errorCount: state.consecutivePrimaryFailures,
        schemaVersion: 1
      }
    });
  };
}

// lib/monitoring/samplers/systemPrimary.ts
var os = __toESM(require("os"));
var fs = __toESM(require("fs/promises"));
var import_child_process = require("child_process");
var import_util = require("util");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
var lastCpuTimes = null;
function computeCpuUsage() {
  const cpus3 = os.cpus();
  if (!lastCpuTimes) {
    lastCpuTimes = cpus3.map((c) => ({ ...c.times }));
    return 0;
  }
  let totalDiff = 0;
  let idleDiff = 0;
  for (let i = 0; i < cpus3.length; i++) {
    const curr = cpus3[i].times;
    const last = lastCpuTimes[i] ?? curr;
    const user = curr.user - last.user;
    const nice = curr.nice - last.nice;
    const sys = curr.sys - last.sys;
    const idle = curr.idle - last.idle;
    const irq = curr.irq - last.irq;
    const total = user + nice + sys + idle + irq;
    totalDiff += total;
    idleDiff += idle;
  }
  lastCpuTimes = cpus3.map((c) => ({ ...c.times }));
  return totalDiff === 0 ? 0 : Math.round((100 - 100 * idleDiff / totalDiff) * 100) / 100;
}
async function getOsRelease() {
  try {
    const { stdout } = await execFileAsync("lsb_release", ["-ds"]);
    if (stdout.trim()) return stdout.trim();
  } catch {
  }
  try {
    const content = await fs.readFile("/etc/os-release", "utf-8");
    const match = content.match(/PRETTY_NAME="(.+)"/);
    if (match) return match[1];
  } catch {
  }
  return `${os.type()} ${os.release()}`;
}
async function sampleSystemPrimary() {
  const cpuUsage = computeCpuUsage();
  const cpus3 = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const osRelease = await getOsRelease();
  return {
    cpuUsage,
    cpuCores: cpus3.length,
    cpuModel: cpus3[0]?.model ?? "Unknown CPU",
    osRelease,
    memory: {
      total: totalMem,
      used: totalMem - freeMem,
      free: freeMem
    }
  };
}

// lib/monitoring/samplers/systemFallback.ts
var os2 = __toESM(require("os"));
var fs2 = __toESM(require("fs/promises"));
async function getCpuUsageFromProc() {
  try {
    const stat = await fs2.readFile("/proc/stat", "utf-8");
    const line = stat.split("\n")[0];
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] ?? 0;
    const total = parts.reduce((a, b) => a + b, 0);
    return total === 0 ? 0 : Math.round((1 - idle / total) * 1e4) / 100;
  } catch {
    return 0;
  }
}
async function getMemFromProc() {
  try {
    const content = await fs2.readFile("/proc/meminfo", "utf-8");
    const lines = content.split("\n");
    const get = (key) => {
      const match = lines.find((l) => l.startsWith(key + ":"));
      return match ? parseInt(match.split(/\s+/)[1] ?? "0", 10) * 1024 : 0;
    };
    return { total: get("MemTotal"), free: get("MemAvailable") };
  } catch {
    return { total: os2.totalmem(), free: os2.freemem() };
  }
}
async function getOsReleaseFallback() {
  try {
    const content = await fs2.readFile("/etc/os-release", "utf-8");
    const match = content.match(/PRETTY_NAME="(.+)"/);
    if (match) return match[1];
  } catch {
  }
  return `${os2.type()} ${os2.release()}`;
}
async function sampleSystemFallback() {
  const [cpuUsage, { total: totalMem, free: freeMem }, osRelease] = await Promise.all([
    getCpuUsageFromProc(),
    getMemFromProc(),
    getOsReleaseFallback()
  ]);
  const cpus3 = os2.cpus();
  return {
    cpuUsage,
    cpuCores: cpus3.length,
    cpuModel: cpus3[0]?.model ?? "Unknown CPU",
    osRelease,
    memory: {
      total: totalMem,
      used: totalMem - freeMem,
      free: freeMem
    }
  };
}

// lib/monitoring/dispatchers/systemDispatcher.ts
function createSystemDispatcher(deps) {
  return createDispatcher({
    name: "system-dispatcher",
    topic: MONITOR_TOPICS.metricsSystem,
    metricKey: "cpu.usage",
    config: deps.config.dispatchers.system,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary: sampleSystemPrimary,
    fallback: sampleSystemFallback,
    publish: deps.publish,
    publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId)
  });
}

// lib/monitoring/samplers/dockerApi.ts
var import_dockerode = __toESM(require("dockerode"));
var docker = new import_dockerode.default();
function calcCpuPercent(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const numCpus = stats.cpu_stats.online_cpus ?? 1;
  if (systemDelta <= 0 || cpuDelta < 0) return "0.00%";
  return `${(cpuDelta / systemDelta * numCpus * 100).toFixed(2)}%`;
}
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)}KiB`;
  return `${bytes}B`;
}
var inspectCache = /* @__PURE__ */ new Map();
var INSPECT_TTL_MS = 3e4;
async function getGpuBindings(containerId) {
  const cached = inspectCache.get(containerId);
  if (cached && Date.now() < cached.expiry) return cached.gpus;
  try {
    const container = docker.getContainer(containerId);
    const inspectData = await container.inspect();
    const deviceRequests = inspectData.HostConfig?.DeviceRequests ?? [];
    const gpus = [];
    for (const req of deviceRequests) {
      if (req.Capabilities?.some((cap) => cap.includes("gpu"))) {
        if (req.DeviceIDs && req.DeviceIDs.length > 0) {
          gpus.push(...req.DeviceIDs);
        } else if (req.Count === -1) {
          gpus.push("all");
        } else if (req.Count) {
          gpus.push(String(req.Count));
        }
      }
    }
    inspectCache.set(containerId, { gpus, expiry: Date.now() + INSPECT_TTL_MS });
    return gpus;
  } catch {
    return [];
  }
}
async function sampleDockerApi() {
  const containers = await docker.listContainers({ all: false });
  if (containers.length === 0) return [];
  const settled = await Promise.allSettled(
    containers.map(async (c) => {
      const instance = docker.getContainer(c.Id);
      const [statsRaw, gpus] = await Promise.all([
        instance.stats({ stream: false }),
        getGpuBindings(c.Id)
      ]);
      const memUsed = statsRaw.memory_stats.usage ?? 0;
      const memLimit = statsRaw.memory_stats.limit ?? 0;
      const memUsage = `${formatBytes(memUsed)} / ${formatBytes(memLimit)}`;
      const cpuPercent = calcCpuPercent(statsRaw);
      const ports = c.Ports.map((p) => {
        if (p.PublicPort) return `${p.PublicPort}->${p.PrivatePort}/${p.Type}`;
        return `${p.PrivatePort}/${p.Type}`;
      }).join(", ");
      const publishedPort = c.Ports.find((p) => p.PublicPort)?.PublicPort;
      return {
        id: c.Id.slice(0, 12),
        name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
        image: c.Image,
        status: c.Status,
        ports,
        publishedPort: publishedPort ? String(publishedPort) : null,
        cpuPercent,
        memUsage,
        memUsedRaw: memUsed,
        gpus
      };
    })
  );
  const metrics = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (metrics.length === 0) {
    throw new Error("Docker API sampling failed for all running containers");
  }
  return metrics;
}

// lib/monitoring/samplers/dockerCli.ts
var import_child_process2 = require("child_process");
var import_util2 = require("util");
var execFileAsync2 = (0, import_util2.promisify)(import_child_process2.execFile);
function parseMemBytes(memStr) {
  if (!memStr) return 0;
  const usedPart = memStr.split("/")[0].trim();
  const match = usedPart.match(/^([0-9.]+)\s*([a-zA-Z]*)$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const units = {
    b: 1,
    kib: 1024,
    mib: 1024 * 1024,
    gib: 1024 * 1024 * 1024,
    tib: 1024 * 1024 * 1024 * 1024,
    kb: 1e3,
    mb: 1e3 * 1e3,
    gb: 1e3 * 1e3 * 1e3,
    tb: 1e3 * 1e3 * 1e3 * 1e3
  };
  return value * (units[unit] ?? 1);
}
function extractPublishedPort(ports) {
  if (!ports) return null;
  const mappings = ports.split(",").map((part) => part.trim()).filter(Boolean);
  for (const mapping of mappings) {
    const directMatch = mapping.match(/^(\d+)->\d+\//);
    if (directMatch) return directMatch[1];
    const hostMatch = mapping.match(/:(\d+)->/);
    if (hostMatch) return hostMatch[1];
  }
  return null;
}
async function sampleDockerCli() {
  const { stdout: psStdout } = await execFileAsync2("docker", ["ps", "--format", "{{json .}}"]);
  if (!psStdout.trim()) return [];
  const containers = psStdout.trim().split("\n").map((line) => JSON.parse(line));
  const { stdout: statsStdout } = await execFileAsync2("docker", [
    "stats",
    "--no-stream",
    "--format",
    "{{json .}}"
  ]);
  const statsMap = /* @__PURE__ */ new Map();
  for (const line of statsStdout.trim().split("\n").filter(Boolean)) {
    const stat = JSON.parse(line);
    statsMap.set(stat.ID, stat);
  }
  const metrics = [];
  for (const c of containers) {
    const containerId = c.ID ?? c.Id ?? "";
    const stat = statsMap.get(containerId) ?? {};
    const gpus = [];
    try {
      const { stdout: inspectOut } = await execFileAsync2("docker", ["inspect", containerId]);
      const inspectData = JSON.parse(inspectOut);
      const deviceRequests = inspectData[0]?.HostConfig?.DeviceRequests ?? [];
      for (const req of deviceRequests) {
        if (req.Capabilities?.some((cap) => cap.includes("gpu"))) {
          if (req.DeviceIDs?.length > 0) {
            gpus.push(...req.DeviceIDs);
          } else if (req.Count === -1) {
            gpus.push("all");
          } else {
            gpus.push(String(req.Count));
          }
        }
      }
    } catch {
    }
    metrics.push({
      id: containerId,
      name: c.Names ?? c.Name ?? containerId,
      image: c.Image ?? "",
      status: c.Status ?? "",
      ports: c.Ports ?? "",
      publishedPort: extractPublishedPort(c.Ports ?? ""),
      cpuPercent: stat.CPUPerc ?? "0.00%",
      memUsage: stat.MemUsage ?? "0B / 0B",
      memUsedRaw: parseMemBytes(stat.MemUsage ?? "0B / 0B"),
      gpus
    });
  }
  return metrics;
}

// lib/monitoring/dispatchers/dockerDispatcher.ts
function createDockerDispatcher(deps) {
  return createDispatcher({
    name: "docker-dispatcher",
    topic: MONITOR_TOPICS.metricsDocker,
    metricKey: "docker.container.stats",
    config: deps.config.dispatchers.docker,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary: sampleDockerApi,
    fallback: sampleDockerCli,
    publish: deps.publish,
    publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId)
  });
}

// lib/monitoring/samplers/gpuPrimary.ts
var import_child_process3 = require("child_process");
var import_util3 = require("util");
var path = __toESM(require("path"));
var fs3 = __toESM(require("fs/promises"));
var execFileAsync3 = (0, import_util3.promisify)(import_child_process3.execFile);
async function findBinary(name, extraPaths = []) {
  const paths = [...extraPaths, "/usr/local/bin", "/usr/bin", "/bin"];
  for (const p of paths) {
    const fullPath = path.join(p, name);
    try {
      await fs3.access(fullPath);
      return fullPath;
    } catch {
    }
  }
  return name;
}
async function sampleNvidia() {
  const nvidiaSmi = await findBinary("nvidia-smi");
  const { stdout } = await execFileAsync3(nvidiaSmi, [
    "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed",
    "--format=csv,noheader,nounits"
  ]);
  const lines = stdout.trim().split("\n");
  return lines.map((line) => {
    const parts = line.split(",").map((s) => s.trim());
    return {
      id: parts[0] ?? "",
      name: parts[1] ?? "",
      type: "Nvidia",
      utilization: parts[2] ? `${parts[2]}%` : "0%",
      memoryUsed: parts[3] ? `${parts[3]} MiB` : "0 MiB",
      memoryTotal: parts[4] ? `${parts[4]} MiB` : "0 MiB",
      temperature: parts[5] ? `${parts[5]} \xB0C` : "-",
      powerDraw: parts[6] ? `${Math.round(parseFloat(parts[6]))}` : "0",
      powerLimit: parts[7] ? `${Math.round(parseFloat(parts[7]))}` : "0",
      fanSpeed: parts[8] && parts[8] !== "N/A" ? `${parts[8]}%` : "-"
    };
  }).filter((g) => g.id);
}
async function sampleAmd() {
  const rocmSmi = await findBinary("rocm-smi", ["/opt/rocm/bin"]);
  const [{ stdout: rocmStdout }, { stdout: memStdout }] = await Promise.all([
    execFileAsync3(rocmSmi, ["-a", "--json"]),
    execFileAsync3(rocmSmi, ["--showmeminfo", "vram", "--json"])
  ]);
  const rocmData = JSON.parse(rocmStdout);
  const memData = JSON.parse(memStdout);
  const gpus = [];
  for (const key of Object.keys(rocmData)) {
    if (!key.startsWith("card")) continue;
    const id = key.replace("card", "");
    const gpu = rocmData[key] ?? {};
    const mem = memData[key] ?? {};
    gpus.push({
      id,
      name: gpu["Device Name"] ?? gpu["Card Series"] ?? `AMD GPU ${id}`,
      type: "AMD",
      utilization: gpu["GPU use (%)"] ? `${gpu["GPU use (%)"]}%` : "0%",
      memoryUsed: mem["VRAM Total Used Memory (B)"] ? `${Math.round(parseInt(mem["VRAM Total Used Memory (B)"], 10) / 1024 / 1024)} MiB` : "0 MiB",
      memoryTotal: mem["VRAM Total Memory (B)"] ? `${Math.round(parseInt(mem["VRAM Total Memory (B)"], 10) / 1024 / 1024)} MiB` : "0 MiB",
      temperature: gpu["Temperature (Sensor edge) (C)"] ? `${gpu["Temperature (Sensor edge) (C)"]} \xB0C` : "-",
      powerDraw: gpu["Current Socket Graphics Package Power (W)"] ? `${Math.round(parseFloat(gpu["Current Socket Graphics Package Power (W)"]))}` : "0",
      powerLimit: gpu["Max Graphics Package Power (W)"] ? `${Math.round(parseFloat(gpu["Max Graphics Package Power (W)"]))}` : "0",
      fanSpeed: gpu["Fan speed (%)"] ? `${gpu["Fan speed (%)"]}%` : "-"
    });
  }
  return gpus;
}
async function sampleGpuPrimary() {
  const results = [];
  const [nvidiaResult, amdResult] = await Promise.allSettled([sampleNvidia(), sampleAmd()]);
  if (nvidiaResult.status === "fulfilled") results.push(...nvidiaResult.value);
  if (amdResult.status === "fulfilled") results.push(...amdResult.value);
  return results;
}

// lib/monitoring/samplers/gpuFallback.ts
var import_child_process4 = require("child_process");
var import_util4 = require("util");
var path2 = __toESM(require("path"));
var fs4 = __toESM(require("fs/promises"));
var execFileAsync4 = (0, import_util4.promisify)(import_child_process4.execFile);
async function findBinary2(name, extraPaths = []) {
  const paths = [...extraPaths, "/usr/local/bin", "/usr/bin", "/bin"];
  for (const p of paths) {
    const fullPath = path2.join(p, name);
    try {
      await fs4.access(fullPath);
      return fullPath;
    } catch {
    }
  }
  return name;
}
async function sampleNvidiaFallback() {
  const nvidiaSmi = await findBinary2("nvidia-smi");
  const { stdout } = await execFileAsync4(nvidiaSmi, [
    "--query-gpu=index,name,memory.total,memory.used",
    "--format=csv,noheader,nounits"
  ]);
  const lines = stdout.trim().split("\n");
  return lines.map((line) => {
    const parts = line.split(",").map((s) => s.trim());
    return {
      id: parts[0] ?? "",
      name: parts[1] ?? "",
      type: "Nvidia",
      utilization: "-",
      memoryUsed: parts[3] ? `${parts[3]} MiB` : "0 MiB",
      memoryTotal: parts[2] ? `${parts[2]} MiB` : "0 MiB",
      temperature: "-",
      powerDraw: "-",
      powerLimit: "-",
      fanSpeed: "-"
    };
  }).filter((g) => g.id);
}
async function sampleAmdFallback() {
  const rocmSmi = await findBinary2("rocm-smi", ["/opt/rocm/bin"]);
  const { stdout: memStdout } = await execFileAsync4(rocmSmi, ["--showmeminfo", "vram", "--json"]);
  const memData = JSON.parse(memStdout);
  const gpus = [];
  for (const key of Object.keys(memData)) {
    if (!key.startsWith("card")) continue;
    const id = key.replace("card", "");
    const mem = memData[key] ?? {};
    gpus.push({
      id,
      name: `AMD GPU ${id}`,
      type: "AMD",
      utilization: "-",
      memoryUsed: mem["VRAM Total Used Memory (B)"] ? `${Math.round(parseInt(mem["VRAM Total Used Memory (B)"], 10) / 1024 / 1024)} MiB` : "0 MiB",
      memoryTotal: mem["VRAM Total Memory (B)"] ? `${Math.round(parseInt(mem["VRAM Total Memory (B)"], 10) / 1024 / 1024)} MiB` : "0 MiB",
      temperature: "-",
      powerDraw: "-",
      powerLimit: "-",
      fanSpeed: "-"
    });
  }
  return gpus;
}
async function sampleGpuFallback() {
  const results = [];
  const [nvidiaResult, amdResult] = await Promise.allSettled([sampleNvidiaFallback(), sampleAmdFallback()]);
  if (nvidiaResult.status === "fulfilled") results.push(...nvidiaResult.value);
  if (amdResult.status === "fulfilled") results.push(...amdResult.value);
  return results;
}

// lib/monitoring/dispatchers/gpuDispatcher.ts
function createGpuDispatcher(deps) {
  return createDispatcher({
    name: "gpu-dispatcher",
    topic: MONITOR_TOPICS.metricsGpu,
    metricKey: "gpu.device.stats",
    config: deps.config.dispatchers.gpu,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary: sampleGpuPrimary,
    fallback: sampleGpuFallback,
    publish: deps.publish,
    publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId)
  });
}

// lib/config/loadConfig.ts
var import_promises = __toESM(require("fs/promises"));
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
var DEFAULT_CONFIG = {
  openWebUIPort: 53e3,
  vllmApiKey: "vllm-test",
  pythonPath: "~/miniconda3/envs/kt/bin/python",
  benchmarkPlotDir: "~/.config/kanban/benchmarks",
  dispatchers: {
    system: { enabled: true, intervalMs: 1e3, timeoutMs: 1e3, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5e3 },
    docker: { enabled: true, intervalMs: 1500, timeoutMs: 5e3, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5e3 },
    gpu: { enabled: true, intervalMs: 1500, timeoutMs: 2e3, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5e3 },
    modelConfig: { enabled: true, intervalMs: 5e3, timeoutMs: 1e3, degradeAfterFailures: 2, recoverAfterSuccesses: 1, apiProbeIntervalMs: 1e4 }
  },
  agent: {
    allowExternalReport: true,
    reportToken: "change-me"
  },
  snapshot: {
    maxAgeMs: 5e3
  },
  health: {
    retentionLimit: 200
  }
};
function getConfigCandidateDirs() {
  return [
    import_path.default.join(import_os.default.homedir(), ".config", "kanban"),
    process.cwd()
  ];
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mergeDeep(base, override) {
  if (!isRecord(base) || !isRecord(override)) {
    return override ?? base;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value;
  }
  return result;
}
async function loadMonitoringConfig() {
  for (const dir of getConfigCandidateDirs()) {
    const configPath = import_path.default.join(dir, "config.json");
    try {
      const content = await import_promises.default.readFile(configPath, "utf8");
      return mergeDeep(DEFAULT_CONFIG, JSON.parse(content));
    } catch {
      continue;
    }
  }
  return { ...DEFAULT_CONFIG };
}
async function loadModelConfig() {
  for (const dir of getConfigCandidateDirs()) {
    const configPath = import_path.default.join(dir, "model-config.json");
    try {
      const content = await import_promises.default.readFile(configPath, "utf8");
      return JSON.parse(content);
    } catch {
      continue;
    }
  }
  return {};
}

// lib/monitoring/samplers/modelConfigPrimary.ts
async function sampleModelConfigPrimary() {
  return loadModelConfig();
}

// lib/monitoring/samplers/modelConfigFallback.ts
var lastKnownGood = {};
function updateModelConfigFallbackCache(config) {
  lastKnownGood = config;
}
async function sampleModelConfigFallback() {
  return { ...lastKnownGood };
}

// lib/monitoring/dispatchers/modelConfigDispatcher.ts
function createModelConfigDispatcher(deps) {
  async function primary() {
    const config = await sampleModelConfigPrimary();
    updateModelConfigFallbackCache(config);
    return config;
  }
  return createDispatcher({
    name: "model-config-dispatcher",
    topic: MONITOR_TOPICS.configModel,
    metricKey: "config.model",
    config: deps.config.dispatchers.modelConfig,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary,
    fallback: sampleModelConfigFallback,
    publish: deps.publish,
    publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId)
  });
}

// lib/monitoring/runtime.ts
var import_crypto2 = require("crypto");
var runtimePromise = null;
var runtimeInstance = null;
function subscribeProjectors(bus, coreProjector, healthProjector) {
  bus.subscribe(
    MONITOR_TOPICS.metricsSystem,
    SUBSCRIPTION_GROUPS.snapshotCore,
    (event) => coreProjector.apply(event)
  );
  bus.subscribe(
    MONITOR_TOPICS.metricsDocker,
    SUBSCRIPTION_GROUPS.snapshotCore,
    (event) => coreProjector.apply(event)
  );
  bus.subscribe(
    MONITOR_TOPICS.metricsGpu,
    SUBSCRIPTION_GROUPS.snapshotCore,
    (event) => coreProjector.apply(event)
  );
  bus.subscribe(
    MONITOR_TOPICS.configModel,
    SUBSCRIPTION_GROUPS.snapshotCore,
    (event) => coreProjector.apply(event)
  );
  bus.subscribe(MONITOR_TOPICS.healthDispatcher, SUBSCRIPTION_GROUPS.snapshotHealth, (event) => {
    healthProjector.apply(event);
    healthProjector.updateQueueStats(bus);
  });
  bus.subscribe(
    MONITOR_TOPICS.agentReport,
    SUBSCRIPTION_GROUPS.snapshotHealth,
    (event) => healthProjector.apply(event)
  );
}
async function createMonitoringRuntime() {
  const config = await loadMonitoringConfig();
  const bus = createMessageBus();
  const coreProjector = createCoreProjector();
  const healthProjector = createHealthProjector();
  subscribeProjectors(bus, coreProjector, healthProjector);
  function publish(event) {
    bus.publish(event);
  }
  function publishHealth(state, eventType, message) {
    bus.publish({
      id: (0, import_crypto2.randomUUID)(),
      topic: MONITOR_TOPICS.healthDispatcher,
      metricKey: "dispatcher.state",
      sourceId: "local",
      agentId: "local-main",
      producerId: state.name,
      timestamp: Date.now(),
      payload: { ...state, eventType, message },
      meta: {
        mode: state.mode,
        latencyMs: state.lastLatencyMs ?? 0,
        sampleWindowMs: state.intervalMs,
        degraded: state.health === "degraded",
        errorCount: state.consecutivePrimaryFailures,
        schemaVersion: 1
      }
    });
  }
  const sharedDeps = {
    config,
    sourceId: "local",
    agentId: "local-main",
    publish,
    publishHealth
  };
  const dispatchers = [
    createSystemDispatcher(sharedDeps),
    createDockerDispatcher(sharedDeps),
    createGpuDispatcher(sharedDeps),
    createModelConfigDispatcher(sharedDeps)
  ];
  const runtime = {
    async start() {
      for (const dispatcher of dispatchers) {
        dispatcher.start();
      }
    },
    async stop() {
      for (const dispatcher of dispatchers) {
        await dispatcher.stop();
      }
    },
    getDashboardSnapshot() {
      return coreProjector.getSnapshot().dashboard;
    },
    getHealthSnapshot() {
      healthProjector.updateQueueStats(bus);
      return healthProjector.getSnapshot();
    },
    getBus() {
      return bus;
    }
  };
  await runtime.start();
  return runtime;
}
async function ensureMonitoringRuntimeStarted() {
  if (runtimeInstance) return runtimeInstance;
  if (!runtimePromise) {
    runtimePromise = createMonitoringRuntime().then((rt) => {
      runtimeInstance = rt;
      return rt;
    });
  }
  return runtimePromise;
}

// lib/monitoring/transport/agentAuth.ts
async function assertAgentToken(token) {
  const config = await loadMonitoringConfig();
  if (!config.agent.allowExternalReport) throw new Error("External agent reporting disabled");
  if (!token || token !== config.agent.reportToken) throw new Error("Invalid agent token");
}

// server.ts
var dev = process.env.NODE_ENV !== "production";
var hostname = "localhost";
var port = Number(process.env.PORT || 3e3);
var app = (0, import_next.default)({ dev, hostname, port });
var handle = app.getRequestHandler();
app.prepare().then(() => {
  const server = (0, import_http.createServer)(async (req, res) => {
    try {
      const parsedUrl = (0, import_url.parse)(req.url || "/", true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });
  const io = new import_socket.Server(server);
  ensureMonitoringRuntimeStarted().then((runtime) => {
    const bus = runtime.getBus();
    const broadcastTopics = Object.values(MONITOR_TOPICS);
    for (const topic of broadcastTopics) {
      bus.subscribe(topic, SUBSCRIPTION_GROUPS.wsBroadcast, (event) => {
        io.emit("monitor:event", event);
      });
    }
  }).catch((err) => {
    console.error("Failed to start monitoring runtime:", err);
  });
  io.on("connection", (socket) => {
    let sshClient = null;
    let sshStream = null;
    const auditLogPath = import_path2.default.join(process.cwd(), "webshell-audit.log");
    const logAudit = (message) => {
      const timestamp = (/* @__PURE__ */ new Date()).toISOString();
      import_fs.default.appendFileSync(auditLogPath, `[${timestamp}] ${message}
`);
    };
    socket.on("init", ({ username, privateKey, token }) => {
      if (!(0, import_webshell_tokens.consumeToken)(token)) {
        logAudit("Rejected unauthorized init attempt (invalid/expired token)");
        socket.emit("error", "Unauthorized: invalid or expired token");
        return;
      }
      logAudit(`Connection attempt for user: ${username}`);
      sshClient = new import_ssh2.Client();
      sshClient.on("ready", () => {
        logAudit(`SSH connection successful for user: ${username}`);
        socket.emit("ready");
        sshClient?.shell((err, stream) => {
          if (err) {
            logAudit(`Shell error: ${err.message}`);
            socket.emit("error", `Shell error: ${err.message}`);
            return;
          }
          sshStream = stream;
          stream.on("close", () => {
            logAudit("SSH stream closed");
            sshClient?.end();
            socket.emit("close");
          }).on("data", (data) => {
            const output = data.toString("utf-8");
            logAudit(`[OUT] ${output.replace(/\r?\n/g, "\\n")}`);
            socket.emit("data", output);
          });
        });
      }).on("error", (err) => {
        logAudit(`SSH connection error: ${err.message}`);
        socket.emit("error", `SSH Connection Error: ${err.message}`);
      }).connect({
        host: "127.0.0.1",
        port: 22,
        username,
        privateKey
      });
    });
    socket.on("data", (data) => {
      if (sshStream) {
        logAudit(`[IN] ${data.replace(/\r?\n/g, "\\n")}`);
        sshStream.write(data);
      }
    });
    socket.on("resize", ({ cols, rows }) => {
      sshStream?.setWindow(rows, cols, 0, 0);
    });
    socket.on("disconnect", () => {
      logAudit("WebSocket client disconnected");
      sshClient?.end();
    });
    socket.on("monitor:init", async () => {
      try {
        const runtime = await ensureMonitoringRuntimeStarted();
        socket.emit("monitor:snapshot", {
          dashboard: runtime.getDashboardSnapshot(),
          health: runtime.getHealthSnapshot()
        });
      } catch (err) {
        socket.emit("monitor:error", { message: err instanceof Error ? err.message : "Runtime error" });
      }
    });
    socket.on("agent:init", async ({ token }) => {
      try {
        await assertAgentToken(token);
        socket.data.agentAuthenticated = true;
        socket.emit("agent:ready");
      } catch (err) {
        socket.emit("agent:error", { message: err instanceof Error ? err.message : "Auth error" });
      }
    });
    socket.on("agent:report", async (event) => {
      if (!socket.data.agentAuthenticated) return;
      try {
        const runtime = await ensureMonitoringRuntimeStarted();
        runtime.getBus().publish(event);
      } catch {
      }
    });
  });
  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
