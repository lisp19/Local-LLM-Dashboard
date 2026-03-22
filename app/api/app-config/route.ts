import { loadAppConfig } from '../../../lib/appConfig';

export async function GET() {
  const config = await loadAppConfig();
  // Only expose non-sensitive fields to the client
  return Response.json({
    openWebUIPort: config.openWebUIPort,
  });
}
