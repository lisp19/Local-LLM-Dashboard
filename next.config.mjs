/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow all dev origins to stop the Next.js 15 cross-origin overlay warnings
  // caused by accessing the dev server from local network IPs
  allowedDevOrigins: ['http://192.168.0.237:3000', 'http://localhost:3000', 'http://127.0.0.1:3000'],

  // Prevent webpack from trying to bundle server-only native binaries
  // (dockerode → docker-modem → ssh2 → sshcrypto.node)
  serverExternalPackages: ['dockerode', 'docker-modem', 'ssh2'],
};

export default nextConfig;
