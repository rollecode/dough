import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const version = JSON.parse(readFileSync("./package.json", "utf8")).version as string;
let commit = "";
try {
  commit = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  /* not a git checkout (e.g. some CI) — version without a hash is fine */
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Exposed to the client so the app can show its version + commit (see AppVersion).
  env: { NEXT_PUBLIC_APP_VERSION: version, NEXT_PUBLIC_APP_COMMIT: commit },
};

export default nextConfig;
