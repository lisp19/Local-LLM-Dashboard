'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { monitorEnv } from '../../env';
import { createClientMonitorStore } from './store';
import { connectMonitorSocket } from './socket';
import type { ClientMonitorState } from './types';
import type { DashboardData, HealthSnapshot } from '../monitoring/contracts';

// Singleton store shared across the app within a client session
let _store: ReturnType<typeof createClientMonitorStore> | null = null;

function getStore() {
  if (!_store) _store = createClientMonitorStore();
  return _store;
}

export function useMonitorTransport(): ClientMonitorState {
  const store = getStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (monitorEnv.monitorProtocolMode === 'legacy') {
      // Legacy mode: poll /api/metrics and /api/system-health every 2s
      store.setLoading();

      async function poll() {
        try {
          const [metricsRes, healthRes] = await Promise.allSettled([
            fetch('/api/metrics').then((r) => r.json() as Promise<DashboardData>),
            fetch('/api/system-health').then((r) => r.json() as Promise<HealthSnapshot>),
          ]);
          const dashboard = metricsRes.status === 'fulfilled' ? metricsRes.value : null;
          const health = healthRes.status === 'fulfilled' ? healthRes.value : null;
          if (dashboard) {
            store.setSnapshot(dashboard, health);
          } else {
            store.setError('Failed to fetch metrics');
          }
        } catch (err) {
          store.setError(err instanceof Error ? err.message : 'Unknown error');
        }
      }

      void poll();
      pollingRef.current = setInterval(() => void poll(), 2000);
    } else {
      // Modern mode: socket.io
      store.setLoading();
      const socket = connectMonitorSocket();

      socket.emit('monitor:init');

      socket.on('monitor:snapshot', ({ dashboard, health }: { dashboard: DashboardData; health: HealthSnapshot }) => {
        store.setSnapshot(dashboard, health);
      });

      socket.on('monitor:event', () => {
        // Re-request snapshot on any event to keep state fresh
        socket.emit('monitor:init');
      });

      socket.on('monitor:error', ({ message }: { message: string }) => {
        store.setError(message);
      });

      socket.on('connect_error', (err: Error) => {
        store.setError(`Socket connection error: ${err.message}`);
      });
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      initializedRef.current = false;
    };
  }, [store]);

  return state;
}
