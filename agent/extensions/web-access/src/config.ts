import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import type { ExecutableStatus, ProviderKeyStatus, WebAccessConfig, WebAccessTtls } from "./types.ts";

export const WEB_ACCESS_ENV_PATH = join(homedir(), ".pi", "agent", ".env");
export const WEB_ACCESS_CACHE_DB_PATH = join(
  homedir(),
  ".pi",
  "agent",
  "cache",
  "web-access",
  "cache.sqlite",
);

export const DEFAULT_WEB_ACCESS_TTLS: WebAccessTtls = {
  searchTtlHours: 24,
  pageTtlHours: 24 * 7,
  githubBranchCloneTtlHours: 24,
  githubCommitCloneTtlHours: 24 * 365 * 10,
  responseTtlHours: 24 * 30,
};

const optionalNonEmptySecret = z.preprocess((value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const EnvSchema = z
  .object({
    EXA_API_KEY: optionalNonEmptySecret,
    FIRECRAWL_API_KEY: optionalNonEmptySecret,
    GITHUB_TOKEN: optionalNonEmptySecret,
  })
  .passthrough();

export function loadWebAccessConfig(env: NodeJS.ProcessEnv = process.env): WebAccessConfig {
  loadDotEnv({
    path: WEB_ACCESS_ENV_PATH,
    override: false,
  });

  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Environment variables should be strings in Node, so this is only a local
    // configuration-shape failure. Never include raw env values in the error.
    throw new Error(`Invalid web-access environment configuration: ${parsed.error.message}`);
  }

  return {
    envPath: WEB_ACCESS_ENV_PATH,
    cacheDbPath: WEB_ACCESS_CACHE_DB_PATH,
    keys: {
      exa: keyStatus(parsed.data.EXA_API_KEY),
      firecrawl: keyStatus(parsed.data.FIRECRAWL_API_KEY),
      githubToken: keyStatus(parsed.data.GITHUB_TOKEN),
    },
    ttls: { ...DEFAULT_WEB_ACCESS_TTLS },
  };
}

export function keyStatus(value: unknown): ProviderKeyStatus {
  return typeof value === "string" && value.trim().length > 0 ? "present" : "missing";
}

export function checkExecutable(name: string): ExecutableStatus {
  const result = spawnSync(name, ["--version"], {
    stdio: "ignore",
    timeout: 1_000,
  });

  return !result.error && typeof result.status === "number" && result.status === 0 ? "available" : "unavailable";
}

export function formatWebAccessDiagnostics(config: WebAccessConfig = loadWebAccessConfig()): string {
  return [
    "Web access:",
    `  Exa key: ${config.keys.exa}`,
    `  Firecrawl key: ${config.keys.firecrawl}`,
    `  GitHub token: ${config.keys.githubToken}`,
    `  gh CLI: ${checkExecutable("gh")}`,
    `  git CLI: ${checkExecutable("git")}`,
    `  Cache DB: ${config.cacheDbPath}`,
    `  Search TTL: ${config.ttls.searchTtlHours}h`,
    `  Page TTL: ${config.ttls.pageTtlHours / 24}d`,
    `  GitHub branch clone TTL: ${config.ttls.githubBranchCloneTtlHours}h`,
    `  GitHub commit clone TTL: ${config.ttls.githubCommitCloneTtlHours / 24 / 365}y`,
    `  Response TTL: ${config.ttls.responseTtlHours / 24}d`,
  ].join("\n");
}

export function formatMissingProviderWarning(config: WebAccessConfig = loadWebAccessConfig()): string | null {
  const missing: string[] = [];
  if (config.keys.exa === "missing") missing.push("EXA_API_KEY");
  if (config.keys.firecrawl === "missing") missing.push("FIRECRAWL_API_KEY");

  if (missing.length === 0) return null;

  return [
    `Web access provider key(s) missing: ${missing.join(", ")}.`,
    "Pi startup is not blocked; provider-backed tools will fail clearly only when those providers are needed.",
    "Run /web-access for local diagnostics.",
  ].join(" ");
}
