import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Fetch for untrusted URLs. The checker reads URLs a freelancer typed, so:
 * - only http and https, only hosts on the delivery's allowlist;
 * - every DNS answer is checked at connect time, so private, loopback,
 *   link-local and metadata addresses are refused even after a redirect or a
 *   DNS rebind;
 * - redirects are followed by hand (at most 3) and each hop is checked again;
 * - size and time are capped.
 * One exception: the app's own /samples/ pages, which hold the demo deliverables.
 */

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb");
  }
  return true;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

const guardedAgent = new Agent({
  connect: {
    lookup(hostname: string, options: object, cb: LookupCb) {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return cb(err, []);
        const list = addresses as { address: string; family: number }[];
        const bad = list.find((a) => isPrivateAddress(a.address));
        if (bad || list.length === 0) {
          return cb(Object.assign(new Error(`Refused to connect to a private address for ${hostname}`), { code: "EPRIVATE" }), []);
        }
        const wantsAll = (options as { all?: boolean }).all;
        if (wantsAll) cb(null, list);
        else cb(null, list[0].address, list[0].family);
      });
    },
  } as never,
});

export type FetchPolicy = {
  allowedHosts: string[];
  selfOrigin?: string; // app origin whose /samples/ pages are allowed
  maxBytes?: number;
  timeoutMs?: number;
};

export type FetchedDoc = { url: string; status: number; contentType: string; body: Buffer };

function checkUrl(raw: string, policy: FetchPolicy): { url: URL; self: boolean } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError(`Only http and https URLs can be read (${url.protocol})`);
  if (url.username || url.password) throw new FetchBlockedError("URLs with credentials are not allowed");
  if (policy.selfOrigin && url.origin === policy.selfOrigin) {
    if (!url.pathname.startsWith("/samples/")) throw new FetchBlockedError("Only the app's sample deliverables can be read from this host");
    return { url, self: true };
  }
  const host = url.hostname.toLowerCase();
  if (!policy.allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new FetchBlockedError(`${host} is not one of the hosts in this delivery`);
  }
  if (isIP(host) && isPrivateAddress(host)) throw new FetchBlockedError("Private addresses cannot be read");
  return { url, self: false };
}

export async function safeFetch(raw: string, policy: FetchPolicy, init: { headers?: Record<string, string> } = {}): Promise<FetchedDoc> {
  const maxBytes = policy.maxBytes ?? 1_500_000;
  const timeoutMs = policy.timeoutMs ?? 10_000;
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const { url, self } = checkUrl(current, policy);
    const res = await undiciFetch(url, {
      redirect: "manual",
      dispatcher: self ? undefined : guardedAgent,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "SignoffChecker/1.0 (+https://github.com/kaifahmed0341/signoff)", ...init.headers },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        const b = Buffer.from(chunk as Uint8Array);
        size += b.length;
        if (size > maxBytes) break;
        chunks.push(b);
      }
    }
    return { url: url.toString(), status: res.status, contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
  }
  throw new FetchBlockedError("Too many redirects");
}
