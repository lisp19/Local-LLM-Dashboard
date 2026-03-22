import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface AppConfig {
  openWebUIPort: number;
  vllmApiKey: string;
}

const DEFAULTS: AppConfig = {
  openWebUIPort: 53000,
  vllmApiKey: 'vllm-test',
};

// Ordered list of config directory candidates
function getConfigCandidateDirs(): string[] {
  return [
    path.join(os.homedir(), '.config', 'kanban'),
    process.cwd(),
  ];
}

export async function loadAppConfig(): Promise<AppConfig> {
  for (const dir of getConfigCandidateDirs()) {
    const configPath = path.join(dir, 'config.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(content);
      // Merge with defaults so missing keys still get sane values
      return { ...DEFAULTS, ...parsed };
    } catch {
      // File doesn't exist or is invalid JSON – try next candidate
    }
  }
  return { ...DEFAULTS };
}

export async function loadModelConfig(): Promise<Record<string, Record<string, string>>> {
  for (const dir of getConfigCandidateDirs()) {
    const configPath = path.join(dir, 'model-config.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      return JSON.parse(content);
    } catch {
      // Try next candidate
    }
  }
  return {};
}
