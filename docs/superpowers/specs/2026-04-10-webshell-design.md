# WebShell Integration Design

## Overview
Add a secure WebShell to the dashboard to allow SSH access to the host machine (`127.0.0.1`). This feature is protected by a password and requires public key (private key upload) authentication. All interactions are audit-logged.

## UI & Interaction

### Entry Point
- A shell icon button (e.g., `<CodeOutlined />` or `<TerminalOutlined />`) located next to the "Host System & GPUs" title in `app/page.tsx`.

### WebShell Modal Flow
1. **Password Verification:**
   - A modal prompts for a password.
   - Verified against a backend file.
2. **SSH Configuration:**
   - Input for SSH Username.
   - File upload for the Private Key (instructing the user to select from `~/.ssh`).
   - "Connect" button.
3. **Terminal Interface:**
   - Uses `xterm.js` and `xterm-addon-fit` for a full-featured terminal experience (colors, resizing).

## Backend Architecture

### Authentication & Config Files
- Location: Same directory as `model-config.json` (root directory `/home/lsp/kanban`).
- **Password File:** `webshell-password.txt`. Initial content: `20001231`.
- **Audit Log:** `webshell-audit.log`. Append-only log of connections and command I/O.

### API Routes
- `POST /api/webshell/auth`: Verifies the provided password against `webshell-password.txt`.

### WebSocket Server (Socket.io)
Since Next.js API routes (App Router) don't natively support WebSocket upgrades easily without a custom server, and Next.js dev/start commands run their own server, we will implement a standalone WebSocket server script (`scripts/webshell-server.ts`) that runs alongside the Next.js app, or integrate Socket.io into a custom Next.js server (`server.js`). 

*Decision:* Given the project already uses `npm run start` (Next.js default), modifying it to a custom `server.js` is the cleanest way to share the same port (3000) for both HTTP and WebSockets.
- Create `server.js` to initialize Next.js and attach `socket.io`.
- Update `package.json` scripts: `"dev": "node server.js"`, `"start": "NODE_ENV=production node server.js"`.

### SSH Connection (`ssh2`)
- The Socket.io server handles the `connection` event.
- Client emits `init` with `username` and `privateKey` (string).
- Server uses `ssh2` `Client` to connect to `127.0.0.1:22`.
- **Audit Logging:** The server intercepts `data` events from the SSH stream and appends them to `webshell-audit.log` with timestamps.

## Security Considerations
- The private key is kept in memory on the Node.js server and never written to disk.
- Password protection prevents unauthorized access to the SSH configuration screen.
- Hardcoded target (`127.0.0.1`) prevents the dashboard from being used as an open proxy/jump host.

## Implementation Steps
1. Create `webshell-password.txt`.
2. Set up `server.js` with `socket.io` and update `package.json`.
3. Implement the `ssh2` logic and audit logging in `server.js`.
4. Create the `POST /api/webshell/auth` endpoint.
5. Build the frontend Modal UI, integrating `xterm.js` and `socket.io-client`.