var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { consumeToken } from './lib/webshell-tokens';
import { ensureMonitoringRuntimeStarted } from './lib/monitoring/runtime';
import { assertAgentToken } from './lib/monitoring/transport/agentAuth';
import { SUBSCRIPTION_GROUPS, MONITOR_TOPICS } from './lib/monitoring/topics';
const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
app.prepare().then(() => {
    const server = createServer((req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const parsedUrl = parse(req.url || '/', true);
            yield handle(req, res, parsedUrl);
        }
        catch (err) {
            console.error('Error occurred handling', req.url, err);
            res.statusCode = 500;
            res.end('internal server error');
        }
    }));
    const io = new SocketIOServer(server);
    // Start the monitoring runtime once server is ready and wire up bus → broadcast
    ensureMonitoringRuntimeStarted().then((runtime) => {
        const bus = runtime.getBus();
        const broadcastTopics = Object.values(MONITOR_TOPICS);
        for (const topic of broadcastTopics) {
            bus.subscribe(topic, SUBSCRIPTION_GROUPS.wsBroadcast, (event) => {
                io.emit('monitor:event', event);
            });
        }
    }).catch((err) => {
        console.error('Failed to start monitoring runtime:', err);
    });
    io.on('connection', (socket) => {
        let sshClient = null;
        let sshStream = null;
        const auditLogPath = path.join(process.cwd(), 'webshell-audit.log');
        const logAudit = (message) => {
            const timestamp = new Date().toISOString();
            fs.appendFileSync(auditLogPath, `[${timestamp}] ${message}\n`);
        };
        // WebShell events
        socket.on('init', ({ username, privateKey, token }) => {
            if (!consumeToken(token)) {
                logAudit('Rejected unauthorized init attempt (invalid/expired token)');
                socket.emit('error', 'Unauthorized: invalid or expired token');
                return;
            }
            logAudit(`Connection attempt for user: ${username}`);
            sshClient = new Client();
            sshClient
                .on('ready', () => {
                logAudit(`SSH connection successful for user: ${username}`);
                socket.emit('ready');
                sshClient === null || sshClient === void 0 ? void 0 : sshClient.shell((err, stream) => {
                    if (err) {
                        logAudit(`Shell error: ${err.message}`);
                        socket.emit('error', `Shell error: ${err.message}`);
                        return;
                    }
                    sshStream = stream;
                    stream
                        .on('close', () => {
                        logAudit('SSH stream closed');
                        sshClient === null || sshClient === void 0 ? void 0 : sshClient.end();
                        socket.emit('close');
                    })
                        .on('data', (data) => {
                        const output = data.toString('utf-8');
                        logAudit(`[OUT] ${output.replace(/\r?\n/g, '\\n')}`);
                        socket.emit('data', output);
                    });
                });
            })
                .on('error', (err) => {
                logAudit(`SSH connection error: ${err.message}`);
                socket.emit('error', `SSH Connection Error: ${err.message}`);
            })
                .connect({
                host: '127.0.0.1',
                port: 22,
                username,
                privateKey,
            });
        });
        socket.on('data', (data) => {
            if (sshStream) {
                logAudit(`[IN] ${data.replace(/\r?\n/g, '\\n')}`);
                sshStream.write(data);
            }
        });
        socket.on('resize', ({ cols, rows }) => {
            sshStream === null || sshStream === void 0 ? void 0 : sshStream.setWindow(rows, cols, 0, 0);
        });
        socket.on('disconnect', () => {
            logAudit('WebSocket client disconnected');
            sshClient === null || sshClient === void 0 ? void 0 : sshClient.end();
        });
        // Monitoring socket events (distinct names — no collision with WebShell)
        socket.on('monitor:init', () => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const runtime = yield ensureMonitoringRuntimeStarted();
                socket.emit('monitor:snapshot', {
                    dashboard: runtime.getDashboardSnapshot(),
                    health: runtime.getHealthSnapshot(),
                });
            }
            catch (err) {
                socket.emit('monitor:error', { message: err instanceof Error ? err.message : 'Runtime error' });
            }
        }));
        socket.on('agent:init', (_a) => __awaiter(void 0, [_a], void 0, function* ({ token }) {
            try {
                yield assertAgentToken(token);
                socket.data.agentAuthenticated = true;
                socket.emit('agent:ready');
            }
            catch (err) {
                socket.emit('agent:error', { message: err instanceof Error ? err.message : 'Auth error' });
            }
        }));
        socket.on('agent:report', (event) => __awaiter(void 0, void 0, void 0, function* () {
            if (!socket.data.agentAuthenticated)
                return;
            try {
                const runtime = yield ensureMonitoringRuntimeStarted();
                runtime.getBus().publish(event);
            }
            catch (_a) {
                // silently drop invalid events from agents
            }
        }));
    });
    server.listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
    });
});
