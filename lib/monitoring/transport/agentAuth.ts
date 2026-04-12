import { loadAppConfig } from '../../appConfig';

export async function assertAgentToken(token: string | null): Promise<void> {
  const config = await loadAppConfig();
  if (!config.agent.allowExternalReport) throw new Error('External agent reporting disabled');
  if (!token || token !== config.agent.reportToken) throw new Error('Invalid agent token');
}
