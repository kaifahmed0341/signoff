import { after } from "next/server";
import { getDb } from "@/lib/db";
import { runCheck } from "@/lib/ai/checker";
import { handleMcp } from "@/lib/mcp/server";
import { projectForToken } from "@/lib/services/mcp-tokens";

export const dynamic = "force-dynamic";
// submit_delivery starts a check that keeps running after the response.
export const maxDuration = 300;

const MAX_BODY = 64_000;

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, { status, headers });
}

/**
 * MCP over Streamable HTTP for a freelancer's coding agent. Stateless: every
 * POST carries a bearer token that reaches exactly one project. Answers are
 * plain JSON; there is no server-sent stream, so GET returns 405.
 */
export async function POST(req: Request) {
  const db = await getDb();
  const auth = await projectForToken(db, req.headers.get("authorization"));
  if (!auth) return jsonRpcError(401, "A valid agent token is required. The freelancer creates one on the project page.", { "www-authenticate": 'Bearer realm="signoff"' });
  const text = await req.text();
  if (text.length > MAX_BODY) return jsonRpcError(413, "Request too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const out = await handleMcp({ db, project: auth.project, tokenLabel: auth.token.label, schedule: (work) => after(work), runCheck }, body);
  if (out === null) return new Response(null, { status: 202 });
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  return new Response("This MCP endpoint answers POST requests with JSON and does not open a stream.", { status: 405, headers: { allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
