import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { FetchBlockedError, isPrivateAddress, safeFetch } from "@/lib/ai/tools/safe-fetch";
import { startStaticServer } from "./helpers";

let server: Server;
let origin: string;
beforeAll(async () => ({ server, origin } = await startStaticServer()));
afterAll(() => server.close());

describe("private address detection", () => {
  it("flags loopback, private, link-local and metadata ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "140.82.112.3", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("safeFetch policy", () => {
  it("refuses hosts that are not in the delivery", async () => {
    await expect(safeFetch("https://evil.example/steal", { allowedHosts: ["good.example"] })).rejects.toBeInstanceOf(FetchBlockedError);
  });
  it("refuses non-http schemes and credentials", async () => {
    await expect(safeFetch("file:///etc/passwd", { allowedHosts: [] })).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(safeFetch("http://u:p@good.example/", { allowedHosts: ["good.example"] })).rejects.toBeInstanceOf(FetchBlockedError);
  });
  it("refuses a listed host that resolves to a private address", async () => {
    await expect(safeFetch(`http://localhost:1/`, { allowedHosts: ["localhost"] })).rejects.toThrow();
    await expect(safeFetch(`${origin}/samples/sample-v1/index.html`, { allowedHosts: ["127.0.0.1"] })).rejects.toBeInstanceOf(FetchBlockedError);
  });
  it("allows only /samples/ on the app's own origin", async () => {
    const doc = await safeFetch(`${origin}/samples/sample-v2/index.html`, { allowedHosts: [], selfOrigin: origin });
    expect(doc.status).toBe(200);
    expect(doc.body.toString()).toContain("Quarrymoor");
    await expect(safeFetch(`${origin}/api/anything`, { allowedHosts: [], selfOrigin: origin })).rejects.toBeInstanceOf(FetchBlockedError);
  });
});
