import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headers are set via Next.js middleware or route handlers for fine-grained
  // control over CSP and security headers (issue #4, #6).
  poweredByHeader: false,
};

export default nextConfig;
