import type { NextConfig } from "next";

const staticExport = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  ...(staticExport ? { output: "export" as const } : {}),
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
