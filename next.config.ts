import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
