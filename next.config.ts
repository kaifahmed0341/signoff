import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the end-to-end tests run a second dev server beside a running one.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Every page reads live database and PayPal state, so pages render per request.
  serverExternalPackages: ["@libsql/client", "libsql", "unpdf"],
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
