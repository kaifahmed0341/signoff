import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { checks, verdicts, type Project } from "../db/schema";
import { audit } from "../services/audit";
import { submitDelivery } from "../services/deliveries";
import { getMilestone, milestoneCriteria, projectMilestones, ServiceError } from "../services/milestones";
import { STATE_LABEL, type MilestoneState } from "../domain/milestone-machine";

/**
 * A small MCP server (Streamable HTTP, JSON responses, stateless) that lets a
 * freelancer's coding agent work its side of one project:
 *
 *   list_milestones       what is agreed and where each milestone stands
 *   submit_delivery       hand in links for a milestone; the checker starts
 *   read_evidence_report  the checker's verdicts and quotes, or its progress
 *
 * There are no payment tools. The agent cannot fund, release, decline, or
 * touch disputes, and it reaches only the project its token was made for.
 */

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "signoff", version: "0.3.0" };

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export type McpContext = {
  db: DB;
  project: Project;
  tokenLabel: string;
  /** Runs work after the response is sent (the checker). */
  schedule: (work: () => Promise<unknown>) => void;
  runCheck: (db: DB, milestoneId: string, deliveryId: string) => Promise<unknown>;
};

const TOOLS = [
  {
    name: "list_milestones",
    title: "List milestones",
    description:
      "List the project's milestones with their acceptance criteria, amounts and current state. A milestone can take a delivery when can_submit is true (the client has funded it, or asked for changes).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "submit_delivery",
    title: "Submit a delivery",
    description:
      "Submit a delivery for one milestone: up to 5 public links (a staging URL, a public GitHub repository, a PDF) and optional notes for the client. The checker starts at once and takes about 10 to 60 seconds; then call read_evidence_report. This does not move any money.",
    inputSchema: {
      type: "object",
      properties: {
        milestone_id: { type: "string", description: "The id from list_milestones" },
        links: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5, description: "Absolute http or https links" },
        notes: { type: "string", maxLength: 4000, description: "Notes for the client. Shown as the freelancer's own words." },
      },
      required: ["milestone_id", "links"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "read_evidence_report",
    title: "Read the evidence report",
    description:
      "Read the latest check for a milestone: each criterion's verdict (met, not met, needs a person), the reasoning, the quotes that survived verification, quotes that were removed and why, and any tampering found. While the check runs, returns its progress.",
    inputSchema: {
      type: "object",
      properties: { milestone_id: { type: "string", description: "The id from list_milestones" } },
      required: ["milestone_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

const submitInput = z.object({
  milestone_id: z.string().min(1).max(64),
  links: z.array(z.string().min(1).max(2000)).min(1).max(5),
  notes: z.string().max(4000).optional(),
});
const milestoneInput = z.object({ milestone_id: z.string().min(1).max(64) });

class ToolError extends Error {}

async function ownedMilestone(ctx: McpContext, id: string) {
  const m = await getMilestone(ctx.db, id).catch(() => null);
  if (!m || m.projectId !== ctx.project.id) throw new ToolError("No milestone with that id in this project");
  return m;
}

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

async function listMilestones(ctx: McpContext) {
  const ms = await projectMilestones(ctx.db, ctx.project.id);
  return {
    project: { name: ctx.project.name, client: ctx.project.clientName },
    milestones: await Promise.all(
      ms.map(async (m) => ({
        id: m.id,
        position: m.position + 1,
        title: m.title,
        deliverable: m.deliverable,
        amount: money(m.amountCents, ctx.project.currency),
        due: m.dueDate,
        state: m.state,
        state_label: STATE_LABEL[m.state as MilestoneState] ?? m.state,
        can_submit: m.state === "funded" || m.state === "changes_requested",
        change_request: m.state === "changes_requested" ? m.changeNote : null,
        acceptance_criteria: (await milestoneCriteria(ctx.db, m.id)).map((c) => c.text),
      })),
    ),
  };
}

async function submit(ctx: McpContext, args: unknown) {
  const input = submitInput.safeParse(args);
  if (!input.success) throw new ToolError(`Invalid arguments: ${input.error.issues[0]?.message}`);
  const m = await ownedMilestone(ctx, input.data.milestone_id);
  if (m.state !== "funded" && m.state !== "changes_requested") {
    throw new ToolError(`This milestone is ${STATE_LABEL[m.state as MilestoneState] ?? m.state}. A delivery can be submitted once the client has funded it, or after they ask for changes.`);
  }
  let deliveryId: string;
  try {
    deliveryId = await submitDelivery(ctx.db, m.id, { links: input.data.links, notes: input.data.notes ?? "", files: [] });
  } catch (err) {
    if (err instanceof ServiceError) throw new ToolError(err.message);
    throw err;
  }
  await audit(ctx.db, { projectId: ctx.project.id, milestoneId: m.id, actor: "operator", type: "agent.delivery_submitted", message: `Delivery submitted by the coding agent "${ctx.tokenLabel}"`, data: { deliveryId } });
  ctx.schedule(() => ctx.runCheck(ctx.db, m.id, deliveryId));
  return { milestone_id: m.id, delivery_id: deliveryId, state: "checking", next: "The checker is running. Call read_evidence_report for this milestone in about 15 seconds." };
}

async function report(ctx: McpContext, args: unknown) {
  const input = milestoneInput.safeParse(args);
  if (!input.success) throw new ToolError(`Invalid arguments: ${input.error.issues[0]?.message}`);
  const m = await ownedMilestone(ctx, input.data.milestone_id);
  const [c] = await ctx.db.select().from(checks).where(eq(checks.milestoneId, m.id)).orderBy(desc(checks.startedAt)).limit(1);
  const base = { milestone_id: m.id, milestone_state: m.state, change_request: m.state === "changes_requested" ? m.changeNote : null };
  if (!c) return { ...base, check: null, message: "No delivery has been checked for this milestone yet." };
  const crit = await milestoneCriteria(ctx.db, m.id);
  if (c.status === "running") {
    return { ...base, check: { status: "running", phase: c.progress?.phase ?? "reading", reading: c.progress?.reading ?? [] }, message: "Still checking. Ask again in a few seconds." };
  }
  if (c.status === "failed") return { ...base, check: { status: "failed", error: c.error } };
  const vs = await ctx.db.select().from(verdicts).where(eq(verdicts.checkId, c.id));
  return {
    ...base,
    check: {
      status: "done",
      checked_by: c.model,
      fallback_reason: c.fallbackReason,
      summary: c.summary,
      tampering_found: (c.findings ?? []).map((f) => ({ kind: f.kind, how: f.how ?? null, excerpt: f.excerpt })),
      criteria: crit.map((cr) => {
        const v = vs.find((x) => x.criterionId === cr.id);
        return {
          criterion: cr.text,
          verdict: v?.verdict ?? null,
          reasoning: v?.reasoning ?? null,
          evidence: (v?.evidence ?? []).map((e) => ({ quote: e.quote, source: e.source })),
          removed_quotes: (v?.dropped ?? []).map((d) => ({ quote: d.quote, reason: d.reason })),
          note: v?.note ?? null,
        };
      }),
    },
  };
}

async function callTool(ctx: McpContext, name: string, args: unknown) {
  try {
    const result = name === "list_milestones" ? await listMilestones(ctx) : name === "submit_delivery" ? await submit(ctx, args ?? {}) : name === "read_evidence_report" ? await report(ctx, args ?? {}) : null;
    if (result === null) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (err) {
    if (err instanceof ToolError) return { content: [{ type: "text", text: err.message }], isError: true };
    throw err;
  }
}

async function handleOne(ctx: McpContext, msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  const ok = (result: unknown) => (isNotification ? null : { jsonrpc: "2.0" as const, id, result });
  const fail = (code: number, message: string) => (isNotification ? null : { jsonrpc: "2.0" as const, id, error: { code, message } });
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid request");
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: `You work the freelancer's side of the Signoff project "${ctx.project.name}". Call list_milestones, submit a delivery for a milestone with can_submit true, then read_evidence_report. You cannot move money.`,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      return ok(await callTool(ctx, name, msg.params?.arguments));
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

/** Handles one POST body. Returns null when every message was a notification (the route answers 202). */
export async function handleMcp(ctx: McpContext, body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid batch" } };
    const out = (await Promise.all(body.map((m) => handleOne(ctx, m as JsonRpcRequest)))).filter((r): r is JsonRpcResponse => r !== null);
    return out.length ? out : null;
  }
  return handleOne(ctx, body as JsonRpcRequest);
}
