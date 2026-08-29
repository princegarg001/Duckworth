import type { NextConfig } from 'next';

const config: NextConfig = {
  // Emits a self-contained server bundle containing only the production files
  // actually imported, which is what keeps the runtime image small enough for
  // distroless to be worth using.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@ipl/contracts', '@ipl/domain'],
  // Linting and type-checking are CI gates in their own right; running them
  // again inside `next build` doubles the slowest step of the pipeline.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default config;
