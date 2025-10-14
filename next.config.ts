import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Configuration webpack pour Fabric.js
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      }
    }
    
    config.externals = config.externals || []
    config.externals.push({
      canvas: 'canvas',
    })
    
    return config
  }
};

export default nextConfig;
