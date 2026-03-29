import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

// Helper to expand ~ to absolute path
function expandHome(pathStr: string): string {
  if (pathStr.startsWith('~')) {
    return path.join(os.homedir(), pathStr.slice(1));
  }
  return pathStr;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || 'overview';
    const rawPath = searchParams.get('path') || '';

    if (action === 'overview') {
      // 1. Get system overall disk usage
      let systemDisk = { total: '0', used: '0', free: '0', percent: '0%', mount: '/' };
      try {
        const { stdout } = await execFileAsync('df', ['-h', '/']);
        const lines = stdout.trim().split('\n');
        if (lines.length > 1) {
          // Filesystem      Size  Used Avail Use% Mounted on
          // /dev/sda1        1.8T  800G  1.0T  45% /
          const parts = lines[1].trim().split(/\s+/);
          if (parts.length >= 6) {
            systemDisk = {
              total: parts[1],
              used: parts[2],
              free: parts[3],
              percent: parts[4],
              mount: parts[5]
            };
          }
        }
      } catch (e) {
        console.error('Failed to get df /:', e);
      }

      // 2. Get key directories size
      const keyDirs = [
        { name: 'Home Directory (~)', path: '~' },
        { name: '/data', path: '/data' }
      ];

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
            path: absPath, // Return absolute path for frontend to use in tree expansion
            size,
            isDir: true,
            isKeyNode: true
          });
        } catch {
          // Skip if doesn't exist or permission denied
        }
      }

      return NextResponse.json({
        system: systemDisk,
        keyDirs: dirSizes
      });

    } else if (action === 'tree') {
      if (!rawPath) {
        return NextResponse.json({ error: 'Path parameter is required for tree action' }, { status: 400 });
      }

      const targetPath = expandHome(rawPath);
      
      // Prevent arbitrary command execution by verifying it's an absolute path
      if (!path.isAbsolute(targetPath)) {
         return NextResponse.json({ error: 'Path must be absolute' }, { status: 400 });
      }

      try {
        await fs.access(targetPath);
      } catch {
        return NextResponse.json({ error: 'Directory not found or inaccessible' }, { status: 404 });
      }

      try {
        // Run du -hd 1 <path> to get children sizes
        // Note: this may take a moment for large directories
        const { stdout } = await execFileAsync('du', ['-hd', '1', targetPath]);
        const lines = stdout.trim().split('\n');
        
        const children = [];
        for (const line of lines) {
          // Output format: "  2.4G	/home/lsp/Downloads"
          const match = line.match(/^([0-9.,]+[KMGTP]?)\s+(.*)$/);
          if (match) {
            const size = match[1];
            const itemPath = match[2];
            
            // Skip the target dir itself
            if (itemPath === targetPath) continue;

            // Get base name
            const name = path.basename(itemPath);

            // Determine if it's a directory (stat) - ignore errors (broken symlinks, etc.)
            let isDir = false;
            try {
              const stats = await fs.lstat(itemPath);
              isDir = stats.isDirectory();
            } catch {
              // Assume it's a file if stat fails
            }

            children.push({
              name,
              path: itemPath,
              size,
              isDir
            });
          }
        }

        // Sort by directory first, then alphabetically
        children.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

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
