import { createHash, randomUUID } from "node:crypto";

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Object(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

export function makeCacheKey(namespace: string, value: unknown): string {
  return `${namespace}:${sha256Object(value)}`;
}

export function contentHash(content: string): string {
  return sha256Hex(content);
}

export function makeResponseId(prefix = "web"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (!isPlainObject(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) sorted[key] = sortForJson(child);
  }
  return sorted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
