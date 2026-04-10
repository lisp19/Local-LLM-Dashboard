// lib/webshell-tokens.js
// 使用 global 确保在 Next.js 的 HMR 或环境隔离下依然共享同一个 Map
const GLOBAL_KEY = '__WEBSHELL_TOKENS__';

if (!global[GLOBAL_KEY]) {
  global[GLOBAL_KEY] = new Map();
}

const validTokens = global[GLOBAL_KEY];
const TOKEN_TTL_MS = 5 * 60 * 1000;

function issueToken(token, ttl) {
  validTokens.set(token, Date.now() + (ttl || TOKEN_TTL_MS));
}

function consumeToken(token) {
  const expiry = validTokens.get(token);
  if (!expiry) return false;
  
  if (Date.now() > expiry) {
    validTokens.delete(token);
    return false;
  }
  
  validTokens.delete(token);
  return true;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [t, expiry] of validTokens.entries()) {
    if (now > expiry) validTokens.delete(t);
  }
}

module.exports = { issueToken, consumeToken, cleanupExpired };
