import { io, type Socket } from 'socket.io-client';

let monitorSocket: Socket | null = null;

export function connectMonitorSocket(): Socket {
  if (!monitorSocket) {
    monitorSocket = io({ autoConnect: true });
  }
  return monitorSocket;
}

export function disconnectMonitorSocket(): void {
  if (monitorSocket) {
    monitorSocket.disconnect();
    monitorSocket = null;
  }
}
