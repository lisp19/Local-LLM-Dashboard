import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import { consumeToken } from './lib/webshell-tokens';
import { ensureMonitoringRuntimeStarted } from './lib/monitoring/runtime';
import { assertAgentToken } from './lib/monitoring/transport/agentAuth';
import { SUBSCRIPTION_GROUPS, MONITOR_TOPICS } from './lib/monitoring/topics';
import type { MetricEnvelope } from './lib/monitoring/contracts';
import type { SshAuthMode } from './lib/webshell/types';
import {
  appendWebShellAuditEvent,
  buildAuditContext,
  createWebShellSessionId,
  ensureWebShellAuditWritable,
  validateWebShellInitPayload,
} from './lib/webshell/serverAudit';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || '/', true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new SocketIOServer(server);

  // Start the monitoring runtime once server is ready and wire up bus → broadcast
  ensureMonitoringRuntimeStarted().then((runtime) => {
    const bus = runtime.getBus();
    const broadcastTopics = Object.values(MONITOR_TOPICS);
    for (const topic of broadcastTopics) {
      bus.subscribe(topic, SUBSCRIPTION_GROUPS.wsBroadcast, (event: MetricEnvelope) => {
        io.emit('monitor:event', event);
      });
    }
  }).catch((err: unknown) => {
    console.error('Failed to start monitoring runtime:', err);
  });

  io.on('connection', (socket) => {
    let sshClient: Client | null = null;
    let sshStream: {
      write(data: string): void;
      setWindow(rows: number, cols: number, height: number, width: number): void;
    } | null = null;
    let sessionId: string | null = null;
    let authMode: SshAuthMode | null = null;
    let sshUsername = '';
    let auditContext: ReturnType<typeof buildAuditContext> | null = null;

    const writeAudit = (event: 'auth_token_rejected' | 'ssh_connect_started' | 'ssh_connect_succeeded' | 'ssh_shell_started' | 'ssh_connect_failed' | 'ssh_disconnected', reason?: string) => {
      if (!sessionId) {
        sessionId = createWebShellSessionId();
      }

      appendWebShellAuditEvent({
        timestamp: new Date().toISOString(),
        event,
        sessionId,
        authMode: authMode ?? undefined,
        sshUsername: sshUsername || undefined,
        reason,
        ...(auditContext ?? {}),
      });
    };

    socket.on('init', (payload: unknown) => {
      try {
        ensureWebShellAuditWritable();
      } catch {
        socket.emit('error', 'WebShell audit unavailable');
        return;
      }

      const validated = validateWebShellInitPayload(payload);
      if (!validated) {
        socket.emit('error', 'Invalid SSH initialization payload');
        return;
      }

      sessionId = createWebShellSessionId();
      authMode = validated.authMode;
      sshUsername = validated.username;
      auditContext = buildAuditContext(socket, validated.audit);

      if (!consumeToken(validated.token)) {
        writeAudit('auth_token_rejected', 'invalid_or_expired_token');
        socket.emit('error', 'Unauthorized: invalid or expired token');
        return;
      }

      writeAudit('ssh_connect_started');
      sshClient = new Client();

      sshClient
        .on('ready', () => {
          writeAudit('ssh_connect_succeeded');
          socket.emit('ready');

          sshClient?.shell((err, stream) => {
            if (err) {
              writeAudit('ssh_connect_failed', `shell:${err.message}`);
              socket.emit('error', `Shell error: ${err.message}`);
              sshClient?.end();
              return;
            }

            sshStream = stream;
            writeAudit('ssh_shell_started');

            stream
              .on('close', () => {
                writeAudit('ssh_disconnected', 'stream_closed');
                sshClient?.end();
                socket.emit('close');
              })
              .on('data', (data: Buffer) => {
                socket.emit('data', data.toString('utf-8'));
              });
          });
        })
        .on('error', (err) => {
          writeAudit('ssh_connect_failed', err.message);
          socket.emit('error', `SSH Connection Error: ${err.message}`);
        })
        .connect({
          host: '127.0.0.1',
          port: 22,
          username: validated.username,
          privateKey: validated.authMode === 'privateKey' ? validated.privateKey : undefined,
          password: validated.authMode === 'password' ? validated.password : undefined,
        });
    });

    socket.on('data', (data: string) => {
      if (sshStream) {
        sshStream.write(data);
      }
    });

    socket.on('resize', ({ cols, rows }: { cols: number; rows: number }) => {
      sshStream?.setWindow(rows, cols, 0, 0);
    });

    socket.on('disconnect', (reason: string) => {
      if (sessionId) {
        writeAudit('ssh_disconnected', reason);
      }
      sshClient?.end();
    });

    // Monitoring socket events (distinct names — no collision with WebShell)
    socket.on('monitor:init', async () => {
      try {
        const runtime = await ensureMonitoringRuntimeStarted();
        socket.emit('monitor:snapshot', {
          dashboard: runtime.getDashboardSnapshot(),
          health: runtime.getHealthSnapshot(),
        });
      } catch (err) {
        socket.emit('monitor:error', { message: err instanceof Error ? err.message : 'Runtime error' });
      }
    });

    socket.on('agent:init', async ({ token }: { token: string }) => {
      try {
        await assertAgentToken(token);
        socket.data.agentAuthenticated = true;
        socket.emit('agent:ready');
      } catch (err) {
        socket.emit('agent:error', { message: err instanceof Error ? err.message : 'Auth error' });
      }
    });

    socket.on('agent:report', async (event: MetricEnvelope) => {
      if (!socket.data.agentAuthenticated) return;
      try {
        const runtime = await ensureMonitoringRuntimeStarted();
        runtime.getBus().publish(event);
      } catch {
        // silently drop invalid events from agents
      }
    });
  });

  if (!process.env.NEXT_PRIVATE_WORKER) {
    server.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
  }
});
