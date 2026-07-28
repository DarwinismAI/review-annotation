import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "pdfjs-dist"],
  experimental: {},
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
};

export default nextConfig;
