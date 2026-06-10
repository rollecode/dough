import type { NextConfig } from "next";
import { readFileSync } from "fs";

const version = JSON.parse(readFileSync("./package.json", "utf8")).version as string;

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Exposed to the client so the app can show its version (see components/layout/app-version).
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
