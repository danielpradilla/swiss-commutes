import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/projects/swiss-commutes',
  trailingSlash: true,
};

export default nextConfig;
