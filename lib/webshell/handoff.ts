import type { WebShellHandoffPayload } from './types';

const HANDOFF_CHANNEL_NAME = 'kanban-webshell-handoff';
const pendingHandoffs = new Map<string, WebShellHandoffPayload>();

type HandoffRequestMessage = {
  type: 'request';
  handoffId: string;
};

type HandoffResponseMessage = {
  type: 'response';
  handoffId: string;
  payload?: WebShellHandoffPayload;
};

export function createWebShellHandoff(payload: WebShellHandoffPayload): string {
  const handoffId = crypto.randomUUID();
  pendingHandoffs.set(handoffId, payload);
  return handoffId;
}

export function listenForWebShellHandoffRequests(): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return () => undefined;
  }

  const channel = new BroadcastChannel(HANDOFF_CHANNEL_NAME);

  channel.onmessage = (event: MessageEvent<HandoffRequestMessage>) => {
    if (event.data?.type !== 'request') {
      return;
    }

    const payload = pendingHandoffs.get(event.data.handoffId);
    if (!payload) {
      return;
    }

    pendingHandoffs.delete(event.data.handoffId);
    channel.postMessage({
      type: 'response',
      handoffId: event.data.handoffId,
      payload,
    } satisfies HandoffResponseMessage);
  };

  return () => channel.close();
}

export function requestWebShellHandoff(handoffId: string, timeoutMs = 1500): Promise<WebShellHandoffPayload | null> {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const channel = new BroadcastChannel(HANDOFF_CHANNEL_NAME);
    const timeout = window.setTimeout(() => {
      channel.close();
      resolve(null);
    }, timeoutMs);

    channel.onmessage = (event: MessageEvent<HandoffResponseMessage>) => {
      if (event.data?.type !== 'response' || event.data.handoffId !== handoffId) {
        return;
      }

      window.clearTimeout(timeout);
      channel.close();
      resolve(event.data.payload ?? null);
    };

    channel.postMessage({
      type: 'request',
      handoffId,
    } satisfies HandoffRequestMessage);
  });
}
