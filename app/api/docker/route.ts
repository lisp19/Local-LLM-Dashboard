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
          let finished = false;

          const safeClose = () => {
            if (finished) return;
            finished = true;
            controller.close();
          };

          const safeError = (err: Error) => {
            if (finished) return;
            finished = true;
            controller.error(err);
          };

          const stopProcess = () => {
            if (finished) return;
            finished = true;
            dockerProcess.kill();
          };

          dockerProcess.stdout.on('data', (chunk) => {
            if (!finished) controller.enqueue(chunk);
          });
          dockerProcess.stderr.on('data', (chunk) => {
            if (!finished) controller.enqueue(chunk);
          });
          dockerProcess.once('close', () => {
            safeClose();
          });
          dockerProcess.once('error', (err) => {
            safeError(err);
          });

          req.signal.addEventListener('abort', () => {
            stopProcess();
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
  } catch (error) {
    console.error('Docker API Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
