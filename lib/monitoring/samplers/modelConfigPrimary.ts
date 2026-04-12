import { loadModelConfig } from '../../config/loadConfig';

export async function sampleModelConfigPrimary(): Promise<Record<string, Record<string, string | number | boolean>>> {
  return loadModelConfig();
}
