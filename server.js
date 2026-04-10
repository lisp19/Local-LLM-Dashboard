/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new Server(server);

  io.on('connection', (socket) => {
    let sshClient = null;
    let sshStream = null;
    const auditLogPath = path.join(process.cwd(), 'webshell-audit.log');

    const logAudit = (message) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(auditLogPath, `[${timestamp}] ${message}\n`);
    };

    socket.on('init', ({ username, privateKey }) => {
      logAudit(`Connection attempt for user: ${username}`);
      sshClient = new Client();

      sshClient.on('ready', () => {
        logAudit(`SSH Connection successful for user: ${username}`);
        socket.emit('ready');
        
        sshClient.shell((err, stream) => {
          if (err) {
            logAudit(`Shell error: ${err.message}`);
            socket.emit('error', 'Shell error: ' + err.message);
            return;
          }
          sshStream = stream;

          stream.on('close', () => {
            logAudit('SSH Stream closed');
            sshClient.end();
            socket.emit('close');
          }).on('data', (data) => {
            logAudit(`[OUT] ${data.toString('utf-8').replace(/\r?\n/g, '\\n')}`);
            socket.emit('data', data.toString('utf-8'));
          });
        });
      }).on('error', (err) => {
        logAudit(`SSH Connection error: ${err.message}`);
        socket.emit('error', 'SSH Connection Error: ' + err.message);
      }).connect({
        host: '127.0.0.1',
        port: 22,
        username: username,
        privateKey: privateKey
      });
    });

    socket.on('data', (data) => {
      if (sshStream) {
        logAudit(`[IN] ${data.replace(/\r?\n/g, '\\n')}`);
        sshStream.write(data);
      }
    });

    socket.on('resize', ({ cols, rows }) => {
      if (sshStream) {
        sshStream.setWindow(rows, cols, 0, 0);
      }
    });

    socket.on('disconnect', () => {
      logAudit('WebSocket client disconnected');
      if (sshClient) {
        sshClient.end();
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
