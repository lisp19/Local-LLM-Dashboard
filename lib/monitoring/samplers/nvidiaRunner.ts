import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execFileAsync = promisify(execFile);

// Global state for deduplication and locking
const pendingPromises = new Map<string, Promise<string>>();
let isRunning = false;
const queue: (() => void)[] = [];

async function acquireLock(): Promise<void> {
  if (!isRunning) {
    isRunning = true;
    return;
  }
  return new Promise<void>((resolve) => {
    queue.push(resolve);
  });
}

function releaseLock(): void {
  if (queue.length > 0) {
    const next = queue.shift();
    if (next) next();
  } else {
    isRunning = false;
  }
}

async function findBinary(name: string, extraPaths: string[] = []): Promise<string> {
  const paths = [...extraPaths, '/usr/local/bin', '/usr/bin', '/bin'];
  for (const p of paths) {
    const fullPath = path.join(p, name);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // continue
    }
  }
  return name;
}

export async function runNvidiaSmi(args: string[], deduplicationKey: string): Promise<string> {
  // 1. Check for existing identical request
  if (pendingPromises.has(deduplicationKey)) {
    return pendingPromises.get(deduplicationKey)!;
  }

  // 2. Create the execution promise
  const promise = (async () => {
    await acquireLock();
    try {
      const nvidiaSmi = await findBinary('nvidia-smi');
      const { stdout } = await execFileAsync(nvidiaSmi, args);
      return stdout;
    } finally {
      releaseLock();
    }
  })();

  // 3. Store in pending map and clean up when done
  pendingPromises.set(deduplicationKey, promise);
  promise.finally(() => {
    pendingPromises.delete(deduplicationKey);
  });

  return promise;
}
