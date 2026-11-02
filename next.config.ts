import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep output-file tracing scoped to the standalone app repository.
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    '/*': [
      './local-bridge/**/*',
      './exporter/**/*',
      './schemas/**/*',
      './**/*.test.ts',
      './**/*.test.tsx',
      './README.md',
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
