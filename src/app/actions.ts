"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { getRail } from "@/lib/payments";
import { FakeRail } from "@/lib/payments/fake-rail";
import { runCheck } from "@/lib/ai/checker";
import { planFromScope, type PlannedProject } from "@/lib/ai/planner";
import { createSampleProject } from "@/lib/sample";
import { fileToText } from "@/lib/services/files";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_UPLOAD_BYTES, submitDelivery } from "@/lib/services/deliveries";
import { approveAndSubmitDispute, getDisputeRow, handleWebhook, simulateChargeback, syncDisputes } from "@/lib/services/disputes";
import {
  ServiceError,
  applyEvent,
  createProject,
  latestDelivery,
  getOwnedMilestone,
  getOwnedProject,
  reconcileProject,
  rotateShareLink,
  sendProject,
  type MilestoneDraft,
} from "@/lib/services/milestones";
import { LOGIN_FAILURES_PER_DAY, consume, loginFailures, noteLoginFailure } from "@/lib/services/usage";
import { createAgentToken, revokeAgentToken } from "@/lib/services/mcp-tokens";
import { WorkspaceLimitError, createDemoWorkspace, ensureOwnerWorkspace } from "@/lib/services/workspaces";
import { hashAddress } from "@/lib/services/ids";
import { currentWorkspace, endSession, passcodeLoginEnabled, passcodeMatches, requireWorkspace, startSession } from "@/lib/web/auth";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof Error) return { ok: false, error: err.message };
  return { ok: false, error: String(err) };
}

// ---------------------------------------------------------------- sessions

/** True only for the production browser tests: a secret header that matches E2E_BYPASS_TOKEN. */
async function isE2eBypass(): Promise<boolean> {
  const expected = env().E2E_BYPASS_TOKEN;
  const got = (await headers()).get("x-signoff-e2e");
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The visitor's address as the host reports it (Vercel sets x-forwarded-for). Used only hashed or for counting. */
async function clientAddress(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "local").split(",")[0].trim().slice(0, 64);
}

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  if (!passcodeLoginEnabled()) return { error: "Passcode sign-in is off on this demo server. Use Try the live demo." };
  const db = await getDb();
  const ip = await clientAddress();
  if ((await loginFailures(db, ip)) >= LOGIN_FAILURES_PER_DAY) return { error: "Too many wrong passcodes from this address today. Try again tomorrow." };
  const code = String(form.get("passcode") ?? "").slice(0, 200);
  if (!passcodeMatches(code)) {
    await noteLoginFailure(db, ip);
    return { error: "That passcode is not right." };
  }
  const w = await ensureOwnerWorkspace(db);
  await startSession(w.id);
  redirect("/dashboard");
}

/** Public demo: one click gives this browser its own private workspace with the sample project loaded. */
export async function startDemo() {
  if (!env().DEMO_MODE) redirect("/login");
  const existing = await currentWorkspace();
  if (!existing) {
    const db = await getDb();
    let w;
    try {
      w = await createDemoWorkspace(db, Date.now(), (await isE2eBypass()) ? null : hashAddress(await clientAddress()));
    } catch (err) {
      if (err instanceof WorkspaceLimitError) redirect("/finished-run?limit=workspaces");
      throw err;
    }
    await startSession(w.id);
    await createSampleProject(db, w.id);
  }
  redirect("/dashboard");
}

export async function logout() {
  await endSession();
  redirect("/");
}

// ---------------------------------------------------------------- projects

export async function loadSampleProject() {
  const w = await requireWorkspace();
  const p = await createSampleProject(await getDb(), w.id);
  redirect(`/projects/${p.id}`);
}

export async function draftPlan(scope: string): Promise<ActionResult<PlannedProject>> {
  const w = await requireWorkspace();
  if (scope.trim().length < 40) return { ok: false, error: "Paste the full scope of work, at least a few sentences." };
  if (scope.length > 30_000) return { ok: false, error: "That scope is over 30,000 characters. Paste the part that describes the work." };
  try {
    const db = await getDb();
    return {
      ok: true,
      data: await planFromScope(scope, async () => {
        const r = await consume(db, w, "ai_plan");
        return r.ok ? null : r.reason;
      }),
    };
  } catch (err) {
    return fail(err);
  }
}

const draftSchema = z
  .array(
    z.object({
      title: z.string().trim().min(1).max(120),
      deliverable: z.string().max(600),
      amountCents: z.number().int().positive().max(100_000_000),
      dueDate: z.string().max(10).nullable().optional(),
      criteria: z
        .array(z.object({ text: z.string().trim().min(1).max(400), sourceQuote: z.string().max(1000), quoteVerified: z.boolean() }))
        .min(1)
        .max(10),
    }),
  )
  .min(1)
  .max(8);

export async function saveProject(input: {
  name: string;
  clientName: string;
  clientEmail?: string;
  scope: string;
  milestones: MilestoneDraft[];
  send: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    if (!input.name.trim() || !input.clientName.trim()) throw new ServiceError("Name the project and the client");
    const parsed = draftSchema.safeParse(input.milestones);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      throw new ServiceError(`Check the milestones: ${i?.path.join(" ")} ${i?.message ?? ""}`.trim());
    }
    const p = await createProject(db, {
      workspaceId: w.id,
      name: input.name.trim().slice(0, 120),
      clientName: input.clientName.trim().slice(0, 120),
      clientEmail: input.clientEmail?.trim().slice(0, 200) || null,
      scope: input.scope.slice(0, 30_000),
      currency: env().CURRENCY,
      milestones: parsed.data,
    });
    if (input.send) await sendProject(db, p.id);
    return { ok: true, data: { id: p.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function sendProjectAction(projectId: string): Promise<ActionResult> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    await getOwnedProject(db, w.id, projectId);
    await sendProject(db, projectId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------- deliveries

export async function submitDeliveryAction(form: FormData): Promise<ActionResult> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    const milestoneId = String(form.get("milestoneId"));
    const m = await getOwnedMilestone(db, w.id, milestoneId);
    const links = String(form.get("links") ?? "").split(/\s+/).filter(Boolean);
    const notes = String(form.get("notes") ?? "").slice(0, 4000);
    const uploads = form.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
    const role = form.get("fileRole") === "deliverable" ? "deliverable" : "notes";
    if (uploads.length > MAX_FILES) throw new ServiceError(`Attach at most ${MAX_FILES} files`);
    if (uploads.reduce((a, f) => a + f.size, 0) > MAX_TOTAL_UPLOAD_BYTES) throw new ServiceError("The files add up to more than 3 MB");
    const files: { name: string; mime: string; text: string; role: "deliverable" | "notes" }[] = [];
    for (const f of uploads) {
      if (f.size > MAX_FILE_BYTES) throw new ServiceError(`${f.name} is over ${MAX_FILE_BYTES / 1_000_000} MB`);
      files.push({ ...(await fileToText(f.name, f.type, new Uint8Array(await f.arrayBuffer()))), role });
    }
    const deliveryId = await submitDelivery(db, milestoneId, { links, notes, files });
    // The check runs after the response is sent; the page polls its progress.
    after(() => runCheck(db, milestoneId, deliveryId));
    revalidatePath(`/projects/${m.projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Runs the checker again on the latest delivery, for when a check failed or timed out. */
export async function rerunCheckAction(milestoneId: string): Promise<ActionResult> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    const m = await getOwnedMilestone(db, w.id, milestoneId);
    const d = await latestDelivery(db, milestoneId);
    if (!d) throw new ServiceError("There is no delivery to check yet");
    await applyEvent(db, m, "SUBMIT_DELIVERY");
    after(() => runCheck(db, milestoneId, d.id));
    revalidatePath(`/projects/${m.projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------- agent access (MCP)

export async function createAgentTokenAction(projectId: string, label: string): Promise<ActionResult<{ token: string }>> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    await getOwnedProject(db, w.id, projectId);
    const { token } = await createAgentToken(db, projectId, String(label ?? "").slice(0, 60));
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: { token } };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeAgentTokenAction(projectId: string, tokenId: string): Promise<ActionResult> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    await getOwnedProject(db, w.id, projectId);
    await revokeAgentToken(db, projectId, String(tokenId));
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------- money and disputes

export async function rotateLinkAction(projectId: string): Promise<ActionResult> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    await getOwnedProject(db, w.id, projectId);
    await rotateShareLink(db, projectId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reconcileAction(projectId: string): Promise<ActionResult<string[]>> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    await getOwnedProject(db, w.id, projectId);
    const rail = getRail();
    const res = await reconcileProject(db, rail, projectId);
    for (const r of res) if (r.local === "released") await syncDisputes(db, rail, r.milestoneId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: res.map((r) => r.action) };
  } catch (err) {
    return fail(err);
  }
}

export async function approveDisputeAction(disputeId: string, pack: string, sandboxOutcome: "win" | "lose" | "none" = "none"): Promise<ActionResult> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    const d = await getDisputeRow(db, disputeId);
    const m = await getOwnedMilestone(db, w.id, d.milestoneId);
    await approveAndSubmitDispute(db, getRail(), disputeId, String(pack).slice(0, 20_000), { sandboxOutcome: sandboxOutcome === "win" || sandboxOutcome === "lose" ? sandboxOutcome : "none" });
    revalidatePath(`/projects/${m.projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Sandbox and test rail only: simulate the client's bank disputing a released milestone. Makes the
 * stand-in dispute-card charge (see simulateChargeback), and on the test rail also sends a signed
 * dispute_opened webhook through the real handler, as Braintree does on the sandbox.
 */
export async function simulateChargebackAction(milestoneId: string): Promise<ActionResult<string>> {
  const w = await requireWorkspace();
  try {
    const db = await getDb();
    const rail = getRail();
    const m = await getOwnedMilestone(db, w.id, milestoneId);
    const d = await simulateChargeback(db, rail, milestoneId);
    if (d && rail instanceof FakeRail) {
      const s = await rail.disputeWebhook("dispute_opened", d.id);
      await handleWebhook(db, rail, s.signature, s.payload);
    }
    revalidatePath(`/projects/${m.projectId}`);
    return { ok: true, data: d ? `Braintree opened dispute ${d.id}` : "The stand-in charge was made; Braintree has not opened the dispute yet. Reconcile in a minute." };
  } catch (err) {
    return fail(err);
  }
}
