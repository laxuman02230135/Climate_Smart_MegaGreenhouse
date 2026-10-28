import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image that runs on the GovTech server.
  output: 'standalone',
  // The app lives in an npm workspace; trace files from the repo root.
  outputFileTracingRoot: path.join(__dirname, '..'),
  poweredByHeader: false,
  reactStrictMode: true,
  // The dev-only badge covered the signed-in user in the sidebar's bottom corner.
  devIndicators: false,
  // No external image optimisation or remote images.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
