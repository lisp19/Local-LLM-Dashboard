import type { WebShellAuditClientPayload } from './types';

type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

async function resolveBrowserReportedIp(): Promise<string | undefined> {
  if (typeof window === 'undefined' || !('RTCPeerConnection' in window)) {
    return undefined;
  }

  return new Promise((resolve) => {
    const RTCPeerConnectionCtor = window.RTCPeerConnection;
    const connection = new RTCPeerConnectionCtor({ iceServers: [] });
    const timeout = window.setTimeout(() => {
      connection.close();
      resolve(undefined);
    }, 1500);

    connection.createDataChannel('webshell-audit');

    connection.onicecandidate = (event) => {
      const candidate = event.candidate?.candidate;
      if (!candidate) {
        return;
      }

      const match = candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
      if (match?.[1]) {
        window.clearTimeout(timeout);
        connection.close();
        resolve(match[1]);
      }
    };

    connection
      .createOffer()
      .then((offer) => connection.setLocalDescription(offer))
      .catch(() => {
        window.clearTimeout(timeout);
        connection.close();
        resolve(undefined);
      });
  });
}

export async function collectBrowserAuditPayload(): Promise<WebShellAuditClientPayload> {
  if (typeof window === 'undefined') {
    return {};
  }

  const navigatorWithUAData = navigator as NavigatorWithUAData;
  const browserReportedIp = await resolveBrowserReportedIp();

  return {
    browserReportedIp,
    userAgent: navigator.userAgent || undefined,
    language: navigator.language || undefined,
    platform: navigatorWithUAData.userAgentData?.platform || navigator.platform || undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`,
  };
}
