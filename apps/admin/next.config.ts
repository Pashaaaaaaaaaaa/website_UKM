import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiBase}/api/:path*` }];
  },
};
export default config;
