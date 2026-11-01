import type { NextConfig } from "next";
import path from 'node:path';

const nextConfig: NextConfig = {
  output:'standalone',
  poweredByHeader:false,
  webpack(config,{webpack}) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/,path.resolve('lib/server/node-env.ts')));
    return config;
  },
};

export default nextConfig;
