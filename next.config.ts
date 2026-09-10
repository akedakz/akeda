import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
