import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function key(label: string): Buffer {
  return createHmac("sha256", env().SESSION_SECRET).update(label).digest();
}

export function sign(label: string, message: string): string {
  return createHmac("sha256", key(label)).update(message).digest("base64url");
}

export function verifySignature(label: string, message: string, signature: string): boolean {
  const expected = Buffer.from(sign(label, message));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Stable JSON: keys sorted at every level, so a signature survives a round trip. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Client link token. It covers the project's link secret, so rotating the secret revokes every old link. */
export function shareToken(projectId: string, linkSecret: string): string {
  return sign("share-link", `${projectId}.${linkSecret}`).slice(0, 22);
}

export function verifyShareToken(projectId: string, linkSecret: string, token: string): boolean {
  const expected = Buffer.from(shareToken(projectId, linkSecret));
  const got = Buffer.from(token);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function newLinkSecret(): string {
  return randomBytes(12).toString("base64url");
}
