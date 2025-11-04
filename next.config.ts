import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure pdf-parse is properly bundled for Vercel serverless functions
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
