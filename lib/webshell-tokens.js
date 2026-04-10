// lib/webshell-tokens.js
// Shared in-memory token store for webshell auth
const validTokens = new Map();
const TOKEN_TTL_MS = 5 * 60 * 1000;

function issueToken(token, ttl) {
  validTokens.set(token, Date.now() + (ttl || TOKEN_TTL_MS));
}

function consumeToken(token) {
  const expiry = validTokens.get(token);
  if (!expiry || Date.now() > expiry) return false;
  validTokens.delete(token);
  return true;
}

function cleanupExpired() {
  for (const [t, expiry] of validTokens.entries()) {
    if (Date.now() > expiry) validTokens.delete(t);
  }
}

module.exports = { issueToken, consumeToken, cleanupExpired };
