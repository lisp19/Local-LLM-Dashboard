import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { statSync } from 'fs';
import { loadAppConfig } from '../../../lib/appConfig';

const execFileAsync = promisify(execFile);

// Helper to expand ~ to absolute path
function expandHome(pathStr: string): string {
  if (pathStr.startsWith('~')) {
    return path.join(os.homedir(), pathStr.slice(1));
  }
  return pathStr;
}

async function getPinnedDirs(): Promise<string[]> {
  try {
    const config = await loadAppConfig();
    if (config.diskPinnedDirs && Array.isArray(config.diskPinnedDirs)) {
      return config.diskPinnedDirs;
    }
  } catch {
    // ignore
  }
  return ['~', '/data'];
}

interface CacheData {
  lastUpdated: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  overview: any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trees: Record<string, any[]>;
  isRefreshing: boolean;
  refreshPromise: Promise<void> | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalCache: CacheData = (global as any).__diskCache || {
  lastUpdated: 0,
  overview: null,
  trees: {},
  isRefreshing: false,
  refreshPromise: null,
};
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).__diskCache = globalCache;
}

async function safeExecDu(targetDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('du', ['-hd', '1', targetDir]);
    return stdout;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    if (e.stdout) return e.stdout; // Return partial output even if du encountered permission denied on some subdirs
    throw e;
  }
}

function parseDuOutput(stdout: string, targetPath: string) {
  const lines = stdout.trim().split('\n');
  const children = [];
  for (const line of lines) {
    const match = line.match(/^([0-9.,]+[KMGTP]?)\s+(.*)$/);
    if (!match) continue;
    const size = match[1];
    const itemPath = match[2];
    if (itemPath === targetPath) continue;

    const name = path.basename(itemPath);
    let isDir = false;
    try {
      const stats = statSync(itemPath);
      isDir = stats.isDirectory();
    } catch {
      isDir = true; // du -hd 1 outputs directories primarily
    }
    children.push({ name, path: itemPath, size, isDir });
  }

  children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return children;
}

async function refreshCache() {
  if (globalCache.refreshPromise) {
    await globalCache.refreshPromise;
    return;
  }

  globalCache.refreshPromise = (async () => {
    globalCache.isRefreshing = true;

    try {
      // 1. Get system overall disk usage
      let systemDisk = { total: '0', used: '0', free: '0', percent: '0%', mount: '/' };
      try {
        const { stdout } = await execFileAsync('df', ['-h', '/']);
        const lines = stdout.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].trim().split(/\s+/);
          if (parts.length >= 6) {
            systemDisk = { total: parts[1], used: parts[2], free: parts[3], percent: parts[4], mount: parts[5] };
          }
        }
      } catch (e) {
        console.error('Failed to get df /:', e);
      }

      // 2. Get key directories size
      const keyDirs = (await getPinnedDirs()).map(p => ({ name: p === '~' ? 'Home Directory (~)' : p, path: p }));
      const dirSizes = [];
      for (const dir of keyDirs) {
        const absPath = expandHome(dir.path);
        try {
          await fs.access(absPath); // check if exists
          const { stdout } = await execFileAsync('du', ['-sh', absPath]);
          const sizeMatch = stdout.trim().match(/^([0-9.,]+[A-Za-z]+)\s+/);
          const size = sizeMatch ? sizeMatch[1] : 'Unknown';
          dirSizes.push({
            name: dir.name,
            path: absPath,
            size,
            isDir: true,
            isKeyNode: true
          });
        } catch {
          // Skip if doesn't exist or permission denied
        }
      }

      globalCache.overview = {
        system: systemDisk,
        keyDirs: dirSizes
      };

      // 3. Pre-fetch 'tree' for root and pinned directories (max depth 1)
      const dirsToPrewarm = ['/', ...dirSizes.map(d => d.path)];
      for (const dir of dirsToPrewarm) {
        try {
          await fs.access(dir);
          const stdout = await safeExecDu(dir);
          globalCache.trees[dir] = parseDuOutput(stdout, dir);
        } catch {
          // Ignore errors for individual tree pre-warming
        }
      }

      globalCache.lastUpdated = Date.now();
    } catch (err) {
      console.error('refreshCache error:', err);
    } finally {
      globalCache.isRefreshing = false;
      globalCache.refreshPromise = null;
    }
  })();

  await globalCache.refreshPromise;
}

// Kick off background cache load on module init
(async () => {
  if (!globalCache.overview && !globalCache.isRefreshing) {
    refreshCache(); // Fire and forget
  }
})();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || 'overview';
    const rawPath = searchParams.get('path') || '';
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Force refresh block
    if (forceRefresh) {
      await refreshCache();
    } else if (!globalCache.overview) {
      // If cache hasn't loaded yet, await it once to prevent empty view
      await refreshCache();
    }

    if (action === 'overview') {
      return NextResponse.json(globalCache.overview);
    } else if (action === 'tree') {
      if (!rawPath) {
        return NextResponse.json({ error: 'Path parameter is required for tree action' }, { status: 400 });
      }

      const targetPath = expandHome(rawPath);
      
      // Prevent arbitrary command execution by verifying it's an absolute path
      if (!path.isAbsolute(targetPath)) {
         return NextResponse.json({ error: 'Path must be absolute' }, { status: 400 });
      }

      // Check cache first
      if (!forceRefresh && globalCache.trees[targetPath]) {
        return NextResponse.json({ children: globalCache.trees[targetPath] });
      }

      try {
        await fs.access(targetPath);
      } catch {
        return NextResponse.json({ error: 'Directory not found or inaccessible' }, { status: 404 });
      }

      try {
        const stdout = await safeExecDu(targetPath);
        const children = parseDuOutput(stdout, targetPath);
        
        // Update cache
        globalCache.trees[targetPath] = children;

        return NextResponse.json({ children });
      } catch (error) {
        console.error('Error fetching tree for path:', targetPath, error);
        return NextResponse.json({ error: 'Permission denied or error calculating sizes' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Disk usage API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
