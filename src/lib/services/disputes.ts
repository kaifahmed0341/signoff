import { desc, eq } from "drizzle-orm";
import type { DB } from "../db";
import { disputes, milestones, webhookEvents, type Dispute, type Milestone } from "../db/schema";
import { RailError, type DisputeInfo, type PaymentRail, type WebhookEvent } from "../payments/rail";
import { audit } from "./audit";
import { ServiceError, getMilestone, getProject, money, reconcileMilestone, verifyRecord, type AcceptanceRecord } from "./milestones";

const TEXT_EVIDENCE_LIMIT = 1800;

export async function milestoneByTransaction(db: DB, transactionId: string): Promise<Milestone | null> {
  const [m] = await db.select().from(milestones).where(eq(milestones.transactionId, transactionId));
  return m ?? null;
}

export async function milestoneDisputes(db: DB, milestoneId: string) {
  return db.select().from(disputes).where(eq(disputes.milestoneId, milestoneId)).orderBy(desc(disputes.createdAt));
}

export async function getDisputeRow(db: DB, disputeId: string): Promise<Dispute> {
  const [d] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!d) throw new ServiceError("Dispute not found", 404);
  return d;
}

/** Insert or update our copy of a Braintree dispute and draft its evidence pack. */
export async function upsertDispute(db: DB, info: DisputeInfo, source: "webhook" | "reconcile"): Promise<Dispute | null> {
  const m = await milestoneByTransaction(db, info.transactionId);
  if (!m) return null;
  const [existing] = await db.select().from(disputes).where(eq(disputes.id, info.id));
  if (existing) {
    if (existing.status !== info.status) {
      await db.update(disputes).set({ status: info.status, updatedAt: new Date() }).where(eq(disputes.id, info.id));
      await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "dispute.updated", message: `Dispute ${info.id} is now ${info.status.replace(/_/g, " ")}`, data: { disputeId: info.id, status: info.status, source } });
    }
    return getDisputeRow(db, info.id);
  }
  const pack = m.acceptanceRecord ? evidencePack(JSON.parse(m.acceptanceRecord) as AcceptanceRecord, m.acceptanceSignature ?? "") : null;
  await db.insert(disputes).values({
    id: info.id,
    milestoneId: m.id,
    transactionId: info.transactionId,
    status: info.status,
    reason: info.reason,
    kind: info.kind,
    amountCents: info.amountCents,
    replyByDate: info.replyByDate,
    evidencePack: pack,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const p = await getProject(db, m.projectId);
  await audit(db, {
    projectId: m.projectId,
    milestoneId: m.id,
    actor: "braintree",
    type: "dispute.opened",
    message: `A ${info.kind ?? "dispute"} for ${money(info.amountCents, p.currency)} was opened (${(info.reason ?? "no reason").replace(/_/g, " ")}). Evidence pack drafted from the signed acceptance record.`,
    data: { disputeId: info.id, transactionId: info.transactionId, replyBy: info.replyByDate, source },
  });
  return getDisputeRow(db, info.id);
}

/** Plain-text evidence assembled only from the signed record. Nothing new is invented here. */
export function evidencePack(r: AcceptanceRecord, signature: string): string {
  const amount = money(r.releasedCents, r.milestone.currency);
  const lines: string[] = [
    `Signed acceptance record for "${r.milestone.title}" in project "${r.project.name}".`,
    `Transaction ${r.transactionId}. Amount released: ${amount}.`,
    `The client, ${r.project.client}, funded this milestone as a hold that was not charged. The money was released only after ${r.signedOffBy} reviewed the delivery and signed off at ${r.signedOffAt} (UTC).`,
    `Deliverable agreed in the scope: ${r.milestone.deliverable}`,
  ];
  if (r.delivery) lines.push(`Delivery version ${r.delivery.version} submitted at ${r.delivery.submittedAt}: ${r.delivery.links.join(", ") || "files only"}.`);
  lines.push("Acceptance criteria, each quoted from the signed scope, with the checker's verdict and the evidence the client saw before signing:");
  r.criteria.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.text} Scope says: "${c.sourceQuote}". Verdict: ${(c.verdict ?? "not checked").replace(/_/g, " ")}.`);
    for (const e of c.evidence.slice(0, 2)) lines.push(`   Evidence from ${e.source}: "${e.quote}"`);
  });
  lines.push(`Record signature (HMAC-SHA256 over the canonical record): ${signature}. The full signed record is available on request.`);
  return lines.join("\n");
}

export function chunkEvidence(text: string, limit = TEXT_EVIDENCE_LIMIT): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const piece = line.length > limit ? line.slice(0, limit - 3) + "..." : line;
    if (cur && cur.length + 1 + piece.length > limit) {
      out.push(cur);
      cur = piece;
    } else cur = cur ? `${cur}\n${piece}` : piece;
  }
  if (cur) out.push(cur);
  return out;
}

/** Operator approves the drafted pack; we submit it to Braintree and finalize. */
export async function approveAndSubmitDispute(db: DB, rail: PaymentRail, disputeId: string, editedPack?: string): Promise<Dispute> {
  const d = await getDisputeRow(db, disputeId);
  const m = await getMilestone(db, d.milestoneId);
  if (d.submittedAt) throw new ServiceError("Evidence was already submitted for this dispute", 409);
  if (d.status !== "open") throw new ServiceError(`The dispute is ${d.status} and no longer takes evidence`, 409);
  if (!m.acceptanceRecord || !m.acceptanceSignature || !verifyRecord(m.acceptanceRecord, m.acceptanceSignature)) {
    throw new ServiceError("The acceptance record is missing or its signature does not verify", 409);
  }
  const pack = (editedPack ?? d.evidencePack ?? "").trim();
  if (!pack) throw new ServiceError("The evidence pack is empty");
  const now = new Date();
  await db.update(disputes).set({ approvedAt: now, evidencePack: pack, updatedAt: now }).where(eq(disputes.id, d.id));
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "operator", type: "dispute.evidence_approved", message: "Operator approved the evidence pack", data: { disputeId: d.id } });

  const ids: string[] = [];
  let final: DisputeInfo;
  try {
    const chunks = chunkEvidence(pack);
    for (const [i, c] of chunks.entries()) ids.push(await rail.addDisputeTextEvidence(d.id, c, i));
    final = await rail.finalizeDispute(d.id);
  } catch (err) {
    const e = err instanceof RailError ? err : new RailError(String(err));
    await db.update(disputes).set({ evidenceIds: ids, updatedAt: new Date() }).where(eq(disputes.id, d.id));
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "dispute.submit_failed", message: `Submitting evidence failed: ${e.message}`, data: { disputeId: d.id, code: e.code, evidenceIds: ids } });
    throw new ServiceError(e.message, 502);
  }
  await db.update(disputes).set({ submittedAt: new Date(), evidenceIds: ids, status: final.status, updatedAt: new Date() }).where(eq(disputes.id, d.id));
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "dispute.evidence_submitted", message: `Submitted ${ids.length} evidence item(s) and finalized. Dispute is now ${final.status.replace(/_/g, " ")}.`, data: { disputeId: d.id, evidenceIds: ids, status: final.status } });
  return getDisputeRow(db, d.id);
}

/** Pull disputes for released milestones, for when no public webhook URL exists (local dev). */
export async function syncDisputes(db: DB, rail: PaymentRail, milestoneId: string) {
  const m = await getMilestone(db, milestoneId);
  if (!m.transactionId || m.state !== "released") return [];
  const found = await rail.findDisputes(m.transactionId);
  for (const info of found) await upsertDispute(db, info, "reconcile");
  return found;
}

// ---------------------------------------------------------------- webhooks

export async function handleWebhook(db: DB, rail: PaymentRail, signature: string, payload: string): Promise<{ status: number; outcome: string }> {
  let event: WebhookEvent;
  try {
    event = await rail.parseWebhook(signature, payload);
  } catch {
    return { status: 400, outcome: "signature rejected" };
  }
  const eventId = `${event.kind}:${event.subjectId ?? "none"}:${event.timestamp}`;
  const [seen] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
  if (seen) return { status: 200, outcome: `duplicate of ${eventId}` };

  let outcome = "ignored";
  if (event.dispute) {
    const row = await upsertDispute(db, event.dispute, "webhook");
    outcome = row ? `dispute ${row.id} ${row.status}` : "dispute for an unknown transaction";
  } else if (event.transaction) {
    const m = await milestoneByTransaction(db, event.transaction.transactionId);
    if (m) {
      const r = await reconcileMilestone(db, rail, m.id, "braintree");
      outcome = `reconciled: ${r.action}`;
    } else outcome = "transaction not tracked here";
  }
  await db.insert(webhookEvents).values({
    id: eventId,
    eventType: event.kind,
    resourceId: event.subjectId,
    verified: true,
    payload: payload.slice(0, 20000),
    outcome,
    receivedAt: new Date(),
  });
  return { status: 200, outcome };
}
