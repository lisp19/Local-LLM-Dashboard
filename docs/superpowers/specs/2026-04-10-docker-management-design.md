# Docker Management Integration Design

## Overview
Add a Docker management interface to each container card in the Kanban dashboard. This provides quick access to common Docker operations (Logs, Inspect, Restart) without leaving the dashboard or needing SSH access to the host.

## UI & Interaction

### Entry Point
- A new button with a Docker-related icon (e.g., `CodeOutlined` or `ConsoleSqlOutlined` from Ant Design, as there is no official Docker icon in standard Ant Design icons, or we can use a custom SVG/text like "Docker") will be added.
- Location: In the container card header, right next to the existing "API Test" button.
- Styling: Ghost/Text button, matching the size and visual weight of the "API Test" button.

### Docker Management Modal
- **Type:** Draggable Modal (matching the behavior of the existing Benchmark modal).
- **Title:** "Docker Management: [Container Name]"
- **Content:** Ant Design `Tabs` component with three panes:

#### 1. Logs Tab (Default)
- **Visuals:** A black, terminal-like `div` with monospace text.
- **Features:** 
  - Real-time streaming of stdout/stderr.
  - Auto-scrolls to the bottom as new logs arrive.
  - "Clear Logs" button to clear the frontend buffer.
  - "Stop Streaming" / "Resume Streaming" toggle.

#### 2. Inspect Tab
- **Visuals:** A scrollable area with a `<pre>` block or a specialized JSON viewer component.
- **Features:** Displays the formatted JSON output of the `docker inspect` command.

#### 3. Controls Tab
- **Visuals:** A simple settings-like page.
- **Features:** 
  - "Restart Container" button (Danger type).
  - Wrapped in a `Popconfirm` ("Are you sure you want to restart this container?") to prevent accidental downtime.
  - Success/Error toast notification (`message.success` / `message.error`) upon completion.

## Backend Architecture

### New API Route: `/api/docker`
A new Next.js Route Handler (`app/api/docker/route.ts`) will be created to handle Docker operations.

#### Endpoint: `POST /api/docker`
Accepts a JSON payload:
```typescript
{
  action: 'restart' | 'inspect' | 'logs',
  containerId: string
}
```

**Action: `restart`**
- Executes: `execFileAsync('docker', ['restart', containerId])`
- Returns: `{ success: true }` or `{ error: '...' }`

**Action: `inspect`**
- Executes: `execFileAsync('docker', ['inspect', containerId])`
- Returns: `{ data: <parsed_json_array> }`

**Action: `logs` (Streaming)**
- Returns: A `ReadableStream` (Server-Sent Events).
- Executes: `spawn('docker', ['logs', '-f', '--tail', '100', containerId])`
- Implementation: 
  - Listen to `stdout.on('data')` and `stderr.on('data')`.
  - Push data chunks to the SSE stream.
  - Handle client disconnects (`req.signal.onabort`) by killing the spawned docker process to prevent zombie processes.

## Error Handling
- **Frontend:** API failures will be caught and displayed using Ant Design's `message.error`. The Logs tab will display connection errors inline.
- **Backend:** `try/catch` blocks around `execFileAsync` and `spawn`. Proper HTTP 500 responses with error messages if the docker daemon is unreachable or the container ID is invalid.

## Scope & Constraints
- Only the 3 specified commands (Logs, Inspect, Restart) are in scope.
- Authentication/Authorization is assumed to be handled at the application/network level (as is the case with the rest of the dashboard).
- Log streaming will default to `--tail 100` to prevent overwhelming the browser with massive historical logs.