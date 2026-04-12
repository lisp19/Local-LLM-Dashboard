import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { consumeToken } from './lib/webshell-tokens';

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

  io.on('connection', (socket) => {
    let sshClient: Client | null = null;
    let sshStream: {
      write(data: string): void;
      setWindow(rows: number, cols: number, height: number, width: number): void;
    } | null = null;
    const auditLogPath = path.join(process.cwd(), 'webshell-audit.log');

    const logAudit = (message: string) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(auditLogPath, `[${timestamp}] ${message}\n`);
    };

    // WebShell events
    socket.on('init', ({ username, privateKey, token }: { username: string; privateKey: string; token: string }) => {
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

          sshClient?.shell((err, stream) => {
            if (err) {
              logAudit(`Shell error: ${err.message}`);
              socket.emit('error', `Shell error: ${err.message}`);
              return;
            }

            sshStream = stream;
            stream
              .on('close', () => {
                logAudit('SSH stream closed');
                sshClient?.end();
                socket.emit('close');
              })
              .on('data', (data: Buffer) => {
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

    socket.on('data', (data: string) => {
      if (sshStream) {
        logAudit(`[IN] ${data.replace(/\r?\n/g, '\\n')}`);
        sshStream.write(data);
      }
    });

    socket.on('resize', ({ cols, rows }: { cols: number; rows: number }) => {
      sshStream?.setWindow(rows, cols, 0, 0);
    });

    socket.on('disconnect', () => {
      logAudit('WebSocket client disconnected');
      sshClient?.end();
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
