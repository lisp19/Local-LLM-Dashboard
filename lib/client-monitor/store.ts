import type { ClientMonitorState } from './types';
import type { DashboardData, HealthSnapshot } from '../monitoring/contracts';

export type ClientMonitorStore = ReturnType<typeof createClientMonitorStore>;

function mergeDashboard(current: DashboardData | null, incoming: DashboardData): DashboardData {
  if (!current) return incoming;

  return {
    system: incoming.system,
    gpus: incoming.gpus.length > 0 ? incoming.gpus : current.gpus,
    containers: incoming.containers.length > 0 ? incoming.containers : current.containers,
  };
}

function mergeHealth(current: HealthSnapshot | null, incoming: HealthSnapshot | null): HealthSnapshot | null {
  if (!incoming) return current;
  if (!current) return incoming;

  return {
    dispatchers: incoming.dispatchers.length > 0 ? incoming.dispatchers : current.dispatchers,
    queue: incoming.queue,
    agents: incoming.agents,
    events: incoming.events,
  };
}

function getContainerUpdatedAt(
  current: Record<string, number>,
  dashboard: DashboardData,
  now: number,
): Record<string, number> {
  const next = { ...current };
  for (const container of dashboard.containers) {
    next[container.runtime.id] = now;
  }
  return next;
}

export function createClientMonitorStore(initialState?: Partial<ClientMonitorState>) {
  let state: ClientMonitorState = {
    dashboard: null,
    health: null,
    status: 'idle',
    error: null,
    lastUpdatedAt: null,
    containerUpdatedAt: {},
    ...initialState,
  };

  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((l) => l());
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLoading: () => {
      state = { ...state, status: state.dashboard ? state.status : 'loading' };
      notify();
    },
    setSnapshot: (dashboard: DashboardData, health: HealthSnapshot | null) => {
      const now = Date.now();
      const nextDashboard = mergeDashboard(state.dashboard, dashboard);
      state = {
        ...state,
        dashboard: nextDashboard,
        health: mergeHealth(state.health, health),
        status: 'live',
        error: null,
        lastUpdatedAt: now,
        containerUpdatedAt: getContainerUpdatedAt(state.containerUpdatedAt, nextDashboard, now),
      };
      notify();
    },
    applyEvent: (dashboard: DashboardData, health: HealthSnapshot | null) => {
      const now = Date.now();
      const nextDashboard = mergeDashboard(state.dashboard, dashboard);
      state = {
        ...state,
        dashboard: nextDashboard,
        health: mergeHealth(state.health, health),
        status: 'live',
        error: null,
        lastUpdatedAt: now,
        containerUpdatedAt: getContainerUpdatedAt(state.containerUpdatedAt, nextDashboard, now),
      };
      notify();
    },
    setError: (message: string) => {
      state = { ...state, status: state.dashboard ? state.status : 'error', error: message };
      notify();
    },
  };
}
