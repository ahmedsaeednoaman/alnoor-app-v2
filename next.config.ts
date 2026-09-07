import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node.js 24 can drop captured output from the detached TypeScript CLI
  // process. Using the compiler API keeps type-checking reliable.
  experimental: {
    useTypeScriptCli: false,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
