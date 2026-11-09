import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the end-to-end tests run a second dev server beside a running one.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Every page reads live database and PayPal state, so pages render per request.
  serverExternalPackages: ["@libsql/client", "libsql", "unpdf"],
  // Database migrations are read from disk at runtime; ship them with every serverless function.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  experimental: {
    // Uploads: up to 3 files of 1 MB each plus form overhead, below the 4.5 MB request cap on Vercel.
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
