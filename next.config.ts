import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep Next's dev badge off the chat's mic button (bottom left).
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
