import type { ClientMonitorState } from './types';
import type { DashboardData, HealthSnapshot } from '../monitoring/contracts';

export type ClientMonitorStore = ReturnType<typeof createClientMonitorStore>;

export function createClientMonitorStore(initialState?: Partial<ClientMonitorState>) {
  let state: ClientMonitorState = {
    dashboard: null,
    health: null,
    status: 'idle',
    error: null,
    lastUpdatedAt: null,
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
      state = { ...state, status: 'loading' };
      notify();
    },
    setSnapshot: (dashboard: DashboardData, health: HealthSnapshot | null) => {
      state = { ...state, dashboard, health, status: 'live', error: null, lastUpdatedAt: Date.now() };
      notify();
    },
    applyEvent: (dashboard: DashboardData, health: HealthSnapshot | null) => {
      state = { ...state, dashboard, health, status: 'live', lastUpdatedAt: Date.now() };
      notify();
    },
    setError: (message: string) => {
      state = { ...state, status: 'error', error: message };
      notify();
    },
  };
}
