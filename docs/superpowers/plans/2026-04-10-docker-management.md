# Docker Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docker management interface to each container card in the Kanban dashboard, providing quick access to Logs, Inspect, and Restart functionality.

**Architecture:** A new Next.js API route (`/api/docker`) will handle backend Docker CLI execution (`restart`, `inspect`, `logs` via SSE). The frontend (`app/page.tsx`) will be updated to include a new Draggable Modal with Tabs for Logs, Inspect, and Controls, triggered by a new button on the container cards.

**Tech Stack:** Next.js App Router, React, Ant Design, Node.js `child_process` (execFileAsync, spawn).

---

### Task 1: Create the Backend API Route for Docker Management

**Files:**
- Create: `app/api/docker/route.ts`
- Create: `scripts/test-docker-api.ts` (for testing)

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-docker-api.ts
import http from 'http';

async function runTests() {
  console.log('Testing /api/docker endpoint...');
  const res = await fetch('http://localhost:3000/api/docker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inspect', containerId: 'invalid-id' })
  });
  
  if (res.status === 404) {
    console.error('FAIL: Endpoint not found');
    process.exit(1);
  }
  
  const data = await res.json();
  if (data.error) {
    console.log('PASS: Endpoint exists and handled error correctly.');
  } else {
    console.error('FAIL: Expected an error for invalid container ID');
    process.exit(1);
  }
}

runTests().catch(console.error);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-docker-api.ts`
Expected: FAIL with "Endpoint not found"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/docker/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, containerId } = body;

    if (!containerId || typeof containerId !== 'string') {
      return NextResponse.json({ error: 'Container ID is required' }, { status: 400 });
    }

    if (action === 'restart') {
      await execFileAsync('docker', ['restart', containerId]);
      return NextResponse.json({ success: true });
    }

    if (action === 'inspect') {
      const { stdout } = await execFileAsync('docker', ['inspect', containerId]);
      return NextResponse.json({ data: JSON.parse(stdout) });
    }

    if (action === 'logs') {
      const dockerProcess = spawn('docker', ['logs', '-f', '--tail', '100', containerId]);

      const stream = new ReadableStream({
        start(controller) {
          dockerProcess.stdout.on('data', (chunk) => {
            controller.enqueue(chunk);
          });
          dockerProcess.stderr.on('data', (chunk) => {
            controller.enqueue(chunk);
          });
          dockerProcess.on('close', () => {
            controller.close();
          });
          dockerProcess.on('error', (err) => {
            controller.error(err);
          });

          req.signal.addEventListener('abort', () => {
            dockerProcess.kill();
          });
        },
        cancel() {
          dockerProcess.kill();
        }
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Docker API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-docker-api.ts` (Ensure Next.js dev server is running on port 3000 in another terminal via `npm run dev`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/docker/route.ts scripts/test-docker-api.ts
git commit -m "feat(api): add docker management endpoints for restart, inspect, and logs"
```

### Task 2: Add Docker Management Modal State and UI to Frontend

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add State Variables and Interfaces**

Locate the `// Benchmark State` section in `app/page.tsx` and add the following state variables right below it:

```tsx
  // Docker Management State
  const [isDockerModalOpen, setIsDockerModalOpen] = useState(false);
  const [dockerTarget, setDockerTarget] = useState<{ id: string; name: string } | null>(null);
  const [dockerLogs, setDockerLogs] = useState('');
  const [isStreamingLogs, setIsStreamingLogs] = useState(false);
  const [dockerInspectData, setDockerInspectData] = useState<any>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [dockerLogs]);
```

- [ ] **Step 2: Add Helper Functions**

Add these functions inside the `DashboardPage` component to handle the Docker actions:

```tsx
  const openDockerManagement = (id: string, name: string) => {
    setDockerTarget({ id, name });
    setDockerLogs('');
    setDockerInspectData(null);
    setIsDockerModalOpen(true);
    fetchInspectData(id);
    startLogStream(id);
  };

  const closeDockerManagement = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsDockerModalOpen(false);
    setIsStreamingLogs(false);
  };

  const fetchInspectData = async (id: string) => {
    try {
      const res = await fetch('/api/docker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inspect', containerId: id })
      });
      const data = await res.json();
      if (data.data) setDockerInspectData(data.data[0]);
    } catch (e) {
      console.error('Failed to fetch inspect data', e);
    }
  };

  const startLogStream = async (id: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setDockerLogs('');
    setIsStreamingLogs(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/docker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logs', containerId: id }),
        signal: controller.signal
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          setDockerLogs(prev => prev + decoder.decode(value, { stream: true }));
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setDockerLogs(prev => prev + `\n\n[Stream Error: ${e.message}]`);
      }
    } finally {
      setIsStreamingLogs(false);
    }
  };

  const restartContainer = async () => {
    if (!dockerTarget) return;
    setIsRestarting(true);
    try {
      const res = await fetch('/api/docker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart', containerId: dockerTarget.id })
      });
      const data = await res.json();
      if (data.success) {
        alert('Container restarted successfully');
      } else {
        alert(`Failed to restart: ${data.error}`);
      }
    } catch (e) {
      alert('Error restarting container');
    } finally {
      setIsRestarting(false);
    }
  };
```

- [ ] **Step 3: Add the Modal UI**

Add the `<Modal>` component for Docker Management at the bottom of the `return` statement in `app/page.tsx` (right above `<DiskUsageModal />`):

```tsx
      <Modal
        title={
          <div 
             className="flex items-center gap-2 cursor-move select-none w-full"
             onMouseOver={() => { if (dragDisabled) setDragDisabled(false); }}
             onMouseOut={() => { setDragDisabled(true); }}
          >
            <SettingOutlined className="text-slate-500" />
            <span>Docker Management: {dockerTarget?.name}</span>
          </div>
        }
        open={isDockerModalOpen}
        onCancel={closeDockerManagement}
        footer={null}
        width={850}
        destroyOnClose
        mask={false}
        wrapClassName="non-blocking-modal-wrap"
        modalRender={(modal) => (
          <Draggable
            disabled={dragDisabled}
            bounds={bounds}
            nodeRef={draggleRef}
            onStart={(event, uiData) => onDragStart(event, uiData)}
          >
            <div ref={draggleRef}>{modal}</div>
          </Draggable>
        )}
      >
        <Tabs defaultActiveKey="1" items={[
          {
            key: '1',
            label: 'Logs',
            children: (
              <div className="pt-2">
                <div className="flex justify-between mb-2">
                  <Text strong>Live Logs</Text>
                  <Space>
                    <Button size="small" onClick={() => setDockerLogs('')}>Clear</Button>
                    <Button size="small" type={isStreamingLogs ? 'default' : 'primary'} onClick={() => isStreamingLogs ? abortControllerRef.current?.abort() : dockerTarget && startLogStream(dockerTarget.id)}>
                      {isStreamingLogs ? 'Stop Stream' : 'Resume Stream'}
                    </Button>
                  </Space>
                </div>
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-300 font-mono text-xs leading-relaxed overflow-y-auto h-[400px] whitespace-pre-wrap break-all">
                  {dockerLogs || <span className="text-slate-600 italic">Waiting for logs...</span>}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )
          },
          {
            key: '2',
            label: 'Inspect',
            children: (
              <div className="pt-2">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-xs overflow-y-auto h-[400px]">
                  {dockerInspectData ? (
                    <pre>{JSON.stringify(dockerInspectData, null, 2)}</pre>
                  ) : (
                    <Spin size="small" />
                  )}
                </div>
              </div>
            )
          },
          {
            key: '3',
            label: 'Controls',
            children: (
              <div className="pt-2 h-[400px]">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <Text strong className="block mb-1">Restart Container</Text>
                    <Text type="secondary" className="text-xs">Restarting the container will cause temporary downtime.</Text>
                  </div>
                  <Button 
                    danger 
                    type="primary" 
                    loading={isRestarting} 
                    onClick={() => {
                      if (window.confirm('Are you sure you want to restart this container?')) {
                        restartContainer();
                      }
                    }}
                  >
                    Restart Container
                  </Button>
                </div>
              </div>
            )
          }
        ]} />
      </Modal>
```

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): add docker management modal with logs, inspect, and restart"
```

### Task 3: Add Entry Point Button to Container Cards

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the Button to the UI**

Locate the "API Test" button in the container card rendering inside `app/page.tsx` (around line 630):
```tsx
                                <Button 
                                    type="primary"
                                    ghost
                                    size="small" 
                                    icon={<PlayCircleOutlined />} 
                                    className="ml-2 px-2 text-xs font-medium shadow-sm transition-all hover:scale-105" 
                                    onClick={() => handleOpenBenchmark(runtime, modelConfig)}
                                    title="Benchmark & Test API"
                                >
                                    API Test
                                </Button>
```

Add the new Docker Management button immediately after it:

```tsx
                                <Button
                                    type="default"
                                    size="small"
                                    icon={<SettingOutlined />}
                                    className="ml-2 px-2 text-xs font-medium shadow-sm transition-all hover:scale-105 text-slate-600 border-slate-300"
                                    onClick={() => openDockerManagement(runtime.id, runtime.name)}
                                    title="Docker Management (Logs, Inspect, Restart)"
                                >
                                    Docker
                                </Button>
```

- [ ] **Step 2: Verify the UI (Manual)**

Run the dev server (`npm run dev`) and visually verify that the "Docker" button appears next to the "API Test" button, and clicking it opens the new Docker Management Modal.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): add docker management entry button to container cards"
```
