import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /**
   * Allow cross-origin requests from the sandbox preview environment
   * (preview-chat-*.space-z.ai) to load /_next/* static assets and chunks.
   * Without this, Next.js 16 dev mode returns a cross-origin warning and the
   * browser throws ChunkLoadError for Radix UI / other vendor chunks.
   */
  allowedDevOrigins: [
    "preview-chat-*.space-z.ai",
    "*.space-z.ai",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ],
};

export default nextConfig;
