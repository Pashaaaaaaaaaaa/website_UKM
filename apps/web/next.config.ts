import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  // Keep `next dev` output isolated from `next build` to avoid stale chunks.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_BASE_URL ?? 'http://localhost:4000'}/api/:path*` }];
  },
};
export default config;
