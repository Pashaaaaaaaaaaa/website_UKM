import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  // Keep `next dev` output isolated from `next build` to avoid stale chunks.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
};
export default config;
