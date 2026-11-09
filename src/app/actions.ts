"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { extractText, getDocumentProxy } from "unpdf";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { getRail } from "@/lib/payments";
import { FakeRail } from "@/lib/payments/fake-rail";
import { runCheck } from "@/lib/ai/checker";
import { planFromScope, type PlannedProject } from "@/lib/ai/planner";
import { createSampleProject } from "@/lib/sample";
import { submitDelivery } from "@/lib/services/deliveries";
import { approveAndSubmitDispute, handleWebhook, syncDisputes } from "@/lib/services/disputes";
import {
  ServiceError,
  createProject,
  getMilestone,
  reconcileProject,
  sendProject,
  type MilestoneDraft,
} from "@/lib/services/milestones";
import { endOperatorSession, isOperator, passcodeMatches, requireOperator, startOperatorSession } from "@/lib/web/auth";
import { audit } from "@/lib/services/audit";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof ServiceError) return { ok: false, error: err.message };
  if (err instanceof Error) return { ok: false, error: err.message };
  return { ok: false, error: String(err) };
}

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const code = String(form.get("passcode") ?? "");
  if (!passcodeMatches(code)) return { error: "That passcode is not right." };
  await startOperatorSession();
  redirect("/dashboard");
}

export async function logout() {
  await endOperatorSession();
  redirect("/");
}

export async function loadSampleProject() {
  await requireOperator();
  const db = await getDb();
  const p = await createSampleProject(db);
  redirect(`/projects/${p.id}`);
}

export async function draftPlan(scope: string): Promise<ActionResult<PlannedProject>> {
  await requireOperator();
  if (scope.trim().length < 40) return { ok: false, error: "Paste the full scope of work, at least a few sentences." };
  try {
    return { ok: true, data: await planFromScope(scope.slice(0, 30_000)) };
  } catch (err) {
    return fail(err);
  }
}

export async function saveProject(input: {
  name: string;
  clientName: string;
  clientEmail?: string;
  scope: string;
  milestones: MilestoneDraft[];
  send: boolean;
}): Promise<ActionResult<{ id: string }>> {
  await requireOperator();
  try {
    const db = await getDb();
    if (!input.name.trim() || !input.clientName.trim()) throw new ServiceError("Name the project and the client");
    const p = await createProject(db, {
      name: input.name.trim(),
      clientName: input.clientName.trim(),
      clientEmail: input.clientEmail?.trim() || null,
      scope: input.scope,
      currency: env().CURRENCY,
      milestones: input.milestones,
    });
    if (input.send) await sendProject(db, p.id);
    return { ok: true, data: { id: p.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function sendProjectAction(projectId: string): Promise<ActionResult> {
  await requireOperator();
  try {
    await sendProject(await getDb(), projectId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

async function fileToText(f: File): Promise<{ name: string; mime: string; text: string }> {
  const buf = new Uint8Array(await f.arrayBuffer());
  if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
    const pdf = await getDocumentProxy(buf);
    return { name: f.name, mime: "application/pdf", text: (await extractText(pdf, { mergePages: true })).text };
  }
  return { name: f.name, mime: f.type || "text/plain", text: new TextDecoder().decode(buf) };
}

export async function submitDeliveryAction(form: FormData): Promise<ActionResult> {
  await requireOperator();
  try {
    const db = await getDb();
    const milestoneId = String(form.get("milestoneId"));
    const links = String(form.get("links") ?? "").split(/\s+/).filter(Boolean);
    const notes = String(form.get("notes") ?? "");
    const files: { name: string; mime: string; text: string }[] = [];
    for (const entry of form.getAll("files")) {
      if (entry instanceof File && entry.size > 0) {
        if (entry.size > 5_000_000) throw new ServiceError(`${entry.name} is over 5 MB`);
        files.push(await fileToText(entry));
      }
    }
    const deliveryId = await submitDelivery(db, milestoneId, { links, notes, files });
    const m = await getMilestone(db, milestoneId);
    after(async () => {
      await runCheck(db, milestoneId, deliveryId);
    });
    revalidatePath(`/projects/${m.projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reconcileAction(projectId: string): Promise<ActionResult<string[]>> {
  await requireOperator();
  try {
    const db = await getDb();
    const rail = getRail();
    const res = await reconcileProject(db, rail, projectId);
    for (const r of res) if (r.local === "released") await syncDisputes(db, rail, r.milestoneId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: res.map((r) => r.action) };
  } catch (err) {
    return fail(err);
  }
}

export async function approveDisputeAction(disputeId: string, pack: string): Promise<ActionResult> {
  await requireOperator();
  try {
    const db = await getDb();
    const d = await approveAndSubmitDispute(db, getRail(), disputeId, pack);
    const m = await getMilestone(db, d.milestoneId);
    revalidatePath(`/projects/${m.projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Sandbox and test rail only: settle a released transaction, then look for disputes. */
export async function settleForTestingAction(milestoneId: string): Promise<ActionResult> {
  await requireOperator();
  try {
    const db = await getDb();
    const rail = getRail();
    if (rail.mode === "production") throw new ServiceError("Not available in production");
    const m = await getMilestone(db, milestoneId);
    if (!m.transactionId) throw new ServiceError("No transaction");
    const hold = await rail.testSettle(m.transactionId);
    await audit(db, { projectId: m.projectId, milestoneId, actor: "operator", type: "sandbox.settled", message: `Sandbox helper settled the transaction (now ${hold.status})`, data: { transactionId: hold.transactionId } });
    await reconcileProject(db, rail, m.projectId);
    await syncDisputes(db, rail, milestoneId);
    revalidatePath(`/projects/${m.projectId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Test rail only: build a correctly signed dispute_opened webhook
 * with the Braintree SDK and send it through the real webhook handler.
 */
export async function simulateDisputeWebhookAction(milestoneId: string): Promise<ActionResult<string>> {
  await requireOperator();
  try {
    const db = await getDb();
    const rail = getRail();
    if (rail.mode !== "fake") throw new ServiceError("On the Braintree sandbox, pay with the dispute test card 4023898493988028 and use Settle instead");
    const m = await getMilestone(db, milestoneId);
    if (!m.transactionId || m.state !== "released") throw new ServiceError("Only a released milestone can be disputed");
    if (rail instanceof FakeRail) rail.openDisputeFor(m.transactionId);
    const s = await rail.sampleWebhook("dispute_opened", m.transactionId);
    const r = await handleWebhook(db, rail, s.signature, s.payload);
    revalidatePath(`/projects/${m.projectId}`);
    return { ok: true, data: r.outcome };
  } catch (err) {
    return fail(err);
  }
}

export async function operatorStatus() {
  return isOperator();
}
