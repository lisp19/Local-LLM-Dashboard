// Fallback: return the last known good model config snapshot
// If no last-known-good exists, return empty object

let lastKnownGood: Record<string, Record<string, string | number | boolean>> = {};

export function updateModelConfigFallbackCache(config: Record<string, Record<string, string | number | boolean>>): void {
  lastKnownGood = config;
}

export async function sampleModelConfigFallback(): Promise<Record<string, Record<string, string | number | boolean>>> {
  return { ...lastKnownGood };
}
