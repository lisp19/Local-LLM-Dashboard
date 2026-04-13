const TOKEN_TTL_MS = 5 * 60 * 1000;

type TokenStore = Map<string, number>;

declare global {
  var __WEBSHELL_TOKENS__: TokenStore | undefined;
}

function getTokenStore(): TokenStore {
  if (!globalThis.__WEBSHELL_TOKENS__) {
    globalThis.__WEBSHELL_TOKENS__ = new Map<string, number>();
  }

  return globalThis.__WEBSHELL_TOKENS__;
}

export function issueToken(token: string, ttl = TOKEN_TTL_MS): void {
  getTokenStore().set(token, Date.now() + ttl);
}

export function consumeToken(token: string): boolean {
  const validTokens = getTokenStore();
  const expiry = validTokens.get(token);

  if (!expiry) {
    return false;
  }

  if (Date.now() > expiry) {
    validTokens.delete(token);
    return false;
  }

  validTokens.delete(token);
  return true;
}

export function cleanupExpired(): void {
  const validTokens = getTokenStore();
  const now = Date.now();

  for (const [token, expiry] of validTokens.entries()) {
    if (now > expiry) {
      validTokens.delete(token);
    }
  }
}
