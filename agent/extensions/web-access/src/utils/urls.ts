import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { FetchMode, GitHubRoute } from "../types.ts";

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const RAW_GITHUB_HOST = "raw.githubusercontent.com";
const COMMON_NOISY_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".venv", "target"]);

export interface ParsedUrl {
  url: URL;
  normalizedUrl: string;
}

export interface ResolvedAddress {
  address: string;
  family?: number;
}

export type ResolveHostname = (hostname: string) => Promise<ResolvedAddress[]>;

export interface GitHubRouteWithCandidates extends GitHubRoute {
  candidateSplits?: Array<{ ref: string; path?: string }>;
}

export function parseHttpUrl(input: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }

  if (isBlockedPrivateHost(url.hostname)) {
    throw new Error("Blocked URL: private or localhost address");
  }

  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  url.hostname = url.hostname.toLowerCase();

  return { url, normalizedUrl: url.toString() };
}

export function normalizeUrl(input: string): string {
  return parseHttpUrl(input).normalizedUrl;
}

export async function assertPublicHttpUrl(input: string, resolveHostname: ResolveHostname = defaultResolveHostname): Promise<void> {
  const { url } = parseHttpUrl(input);
  await assertPublicHostname(url.hostname, resolveHostname);
}

export async function defaultResolveHostname(hostname: string): Promise<ResolvedAddress[]> {
  return lookup(hostname.replace(/^\[|\]$/g, ""), { all: true, verbatim: true });
}

export function domainFromUrl(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function parseGitHubUrl(input: string): GitHubRouteWithCandidates | null {
  if (/(?:^|\/|%2f)\.\.?(?:\/|$|%2f)/i.test(input)) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split("/").filter(Boolean).map(safeDecodePathSegment);
  if (segments.length < 2) return null;

  const [owner, rawRepo, area, ...rest] = segments;
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!isSafeGitHubName(owner) || !isSafeGitHubName(repo)) return null;

  if (!area) return { kind: "repo", owner, repo };

  if (area === "issues" && rest.length >= 1) {
    const number = parsePositiveInteger(rest[0]);
    return number ? { kind: "issue", owner, repo, number } : null;
  }

  if (area === "pull" && rest.length >= 1) {
    const number = parsePositiveInteger(rest[0]);
    return number ? { kind: "pull", owner, repo, number } : null;
  }

  if (area === "tree" || area === "blob") {
    if (rest.length === 0 || rest.some((segment) => !isSafeGitHubPathSegment(segment))) return null;
    const candidateSplits = buildGitHubRefPathCandidates(rest);
    const selected = chooseGitHubRefPathSplit(area, rest, candidateSplits);
    return {
      kind: area,
      owner,
      repo,
      ref: selected.ref,
      path: selected.path,
      candidateSplits,
    };
  }

  // Non-code GitHub pages intentionally fall through to Firecrawl/structured handling later.
  return null;
}

export function isGitHubCodeRoute(route: GitHubRoute | null): boolean {
  return route?.kind === "repo" || route?.kind === "tree" || route?.kind === "blob";
}

export function isGitHubIssueOrPullRoute(route: GitHubRoute | null): boolean {
  return route?.kind === "issue" || route?.kind === "pull";
}

export function isDirectFetchUrlCandidate(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === RAW_GITHUB_HOST) return true;
  if (GITHUB_HOSTS.has(host) && path.includes("/raw/")) return true;
  if (path.endsWith("/llms.txt") || path.endsWith("/llms-full.txt") || path.endsWith("/llms-small.txt")) return true;
  if (looksLikeStaticTextAsset(path)) return true;

  return false;
}

export function isDirectFetchContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!mime || mime === "text/html" || mime === "application/xhtml+xml") return false;
  if (mime.startsWith("text/")) return true;
  return new Set([
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/rss+xml",
    "application/atom+xml",
    "application/x-ndjson",
    "application/yaml",
    "application/x-yaml",
    "application/javascript",
    "application/ecmascript",
  ]).has(mime);
}

export function shouldTryDirectFetch(input: string, contentType?: string | null): boolean {
  return isDirectFetchUrlCandidate(input) || isDirectFetchContentType(contentType);
}

export function isLikelyHtml(content: string): boolean {
  const sample = content.slice(0, 2048).toLowerCase();
  return /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(sample);
}

export function safeJoinGitHubPath(parts: string[]): string | undefined {
  if (parts.length === 0) return undefined;
  if (parts.some((part) => !isSafeGitHubPathSegment(part))) return undefined;
  return parts.join("/");
}

export function isNoisyRepoPath(path: string): boolean {
  return path.split(/[\\/]/).some((part) => COMMON_NOISY_DIRS.has(part));
}

function buildGitHubRefPathCandidates(parts: string[]): Array<{ ref: string; path?: string }> {
  const candidates: Array<{ ref: string; path?: string }> = [];
  for (let i = 1; i <= parts.length; i += 1) {
    const ref = parts.slice(0, i).join("/");
    const path = safeJoinGitHubPath(parts.slice(i));
    candidates.push(path ? { ref, path } : { ref });
  }
  return candidates;
}

function chooseGitHubRefPathSplit(
  area: "tree" | "blob",
  parts: string[],
  candidates: Array<{ ref: string; path?: string }>,
): { ref: string; path?: string } {
  if (parts.length === 1) return candidates[0]!;

  const first = parts[0]!;
  const firstSplit = candidates[0]!;
  const allAsRef = candidates[candidates.length - 1]!;

  if (isCommonRefName(first)) return firstSplit;
  if (area === "blob") return firstSplit;

  // Tree URLs are ambiguous when branch names contain slashes. If no later
  // segment looks like a path, prefer treating the full remainder as the ref.
  const restLooksPathy = parts.slice(1).some((part) => /\.|^(src|lib|packages|apps|docs|test|tests|examples)$/i.test(part));
  return restLooksPathy ? firstSplit : allAsRef;
}

function isCommonRefName(ref: string): boolean {
  return /^(main|master|develop|development|dev|trunk|HEAD|v?\d+(?:\.\d+){0,3})$/i.test(ref);
}

function looksLikeStaticTextAsset(path: string): boolean {
  return /\.(txt|md|mdx|json|jsonl|ndjson|xml|yaml|yml|toml|ini|csv|tsv|js|mjs|cjs|ts|tsx|jsx|css|scss|less|rs|go|py|rb|java|kt|kts|c|cc|cpp|h|hpp|cs|php|swift|sh|bash|zsh|fish|sql|graphql|gql|proto|dockerfile)$/i.test(
    path,
  );
}

function safeDecodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isSafeGitHubName(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== "..";
}

function isSafeGitHubPathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
  );
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateFetchModeForUrl(fetchMode: FetchMode, url: string): void {
  if (fetchMode === "github" && !parseGitHubUrl(url)) {
    throw new Error(`fetchMode "github" only supports GitHub repo/blob/tree/issue/pull URLs: ${url}`);
  }
}

async function assertPublicHostname(rawHostname: string, resolveHostname: ResolveHostname): Promise<void> {
  const hostname = normalizeHostname(rawHostname);
  if (isBlockedPrivateHost(hostname)) throw new Error("Blocked URL: private or localhost address");

  if (isIP(hostname) !== 0) return;

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHostname(hostname);
  } catch {
    throw new Error("Blocked URL: unable to resolve hostname safely");
  }

  if (addresses.length === 0) throw new Error("Blocked URL: unable to resolve hostname safely");
  if (addresses.some((address) => isBlockedIpAddress(address.address))) {
    throw new Error("Blocked URL: private or localhost address");
  }
}

function isBlockedPrivateHost(rawHostname: string): boolean {
  const hostname = normalizeHostname(rawHostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
  if (isBlockedIpAddress(hostname)) return true;

  // Single-label names are internal-only in normal resolver configurations.
  return isIP(hostname) === 0 && !hostname.includes(".");
}

function isBlockedIpAddress(ip: string): boolean {
  const hostname = normalizeHostname(ip);
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isBlockedIPv4(hostname);
  if (ipVersion === 6) return isBlockedIPv6(hostname);
  return false;
}

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true;
  return (
    ipv4InCidr(value, "0.0.0.0", 8) ||
    ipv4InCidr(value, "10.0.0.0", 8) ||
    ipv4InCidr(value, "127.0.0.0", 8) ||
    ipv4InCidr(value, "169.254.0.0", 16) ||
    ipv4InCidr(value, "172.16.0.0", 12) ||
    ipv4InCidr(value, "192.168.0.0", 16) ||
    ipv4InCidr(value, "100.64.0.0", 10)
  );
}

function isBlockedIPv6(ip: string): boolean {
  const bytes = parseIPv6(ip);
  if (!bytes) return true;
  const mappedIPv4 = ipv4FromMappedIPv6(bytes);
  if (mappedIPv4) return isBlockedIPv4(mappedIPv4);

  return (
    bytes.every((byte) => byte === 0) ||
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1 ||
    bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80 ||
    (bytes[0]! & 0xfe) === 0xfc
  );
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function ipv4InCidr(ip: number, base: string, prefixLength: number): boolean {
  const baseValue = ipv4ToInt(base);
  if (baseValue === null) return false;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ip & mask) === (baseValue & mask);
}

function parseIPv6(ip: string): Uint8Array | null {
  const zoneIndex = ip.indexOf("%");
  const withoutZone = zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip;
  const ipv4Match = withoutZone.match(/(.+:)(\d+\.\d+\.\d+\.\d+)$/);
  let normalized = withoutZone;
  let ipv4Bytes: number[] = [];

  if (ipv4Match) {
    const value = ipv4ToInt(ipv4Match[2]!);
    if (value === null) return null;
    ipv4Bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    normalized = `${ipv4Match[1]}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;

  const words = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (words.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (const [index, word] of words.entries()) {
    if (!/^[0-9a-f]{1,4}$/i.test(word)) return null;
    const value = Number.parseInt(word, 16);
    bytes[index * 2] = (value >>> 8) & 0xff;
    bytes[index * 2 + 1] = value & 0xff;
  }

  // Preserve dotted IPv4 parsing semantics for mapped addresses.
  if (ipv4Bytes.length === 4) {
    bytes[12] = ipv4Bytes[0]!;
    bytes[13] = ipv4Bytes[1]!;
    bytes[14] = ipv4Bytes[2]!;
    bytes[15] = ipv4Bytes[3]!;
  }

  return bytes;
}

function ipv4FromMappedIPv6(bytes: Uint8Array): string | null {
  const isMapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (!isMapped) return null;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}
