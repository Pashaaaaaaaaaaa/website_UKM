import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  // Keep `next dev` output isolated from `next build`; both can otherwise
  // overwrite the same chunk manifests while a local dashboard is running.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiBase}/api/:path*` }];
  },
};
export default config;
