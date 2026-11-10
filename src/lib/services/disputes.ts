import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { DB } from "../db";
import { disputes, milestones, webhookEvents, type Dispute, type Milestone } from "../db/schema";
import { RailError, type DisputeInfo, type PaymentRail, type WebhookEvent } from "../payments/rail";
import { audit } from "./audit";
import { ServiceError, getMilestone, getProject, money, reconcileMilestone, verifyRecord, type AcceptanceRecord } from "./milestones";

const TEXT_EVIDENCE_LIMIT = 1800;

/** The milestone a transaction belongs to: its own hold, or the sandbox stand-in charge made for its dispute. */
export async function milestoneByTransaction(db: DB, transactionId: string): Promise<Milestone | null> {
  const [m] = await db.select().from(milestones).where(or(eq(milestones.transactionId, transactionId), eq(milestones.disputeSimTransactionId, transactionId)));
  return m ?? null;
}

function draftPack(m: Milestone): string | null {
  return m.acceptanceRecord ? evidencePack(JSON.parse(m.acceptanceRecord) as AcceptanceRecord, m.acceptanceSignature ?? "") : null;
}

export async function milestoneDisputes(db: DB, milestoneId: string) {
  return db.select().from(disputes).where(eq(disputes.milestoneId, milestoneId)).orderBy(desc(disputes.createdAt));
}

export async function getDisputeRow(db: DB, disputeId: string): Promise<Dispute> {
  const [d] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!d) throw new ServiceError("Dispute not found", 404);
  return d;
}

/**
 * Insert or update our copy of a Braintree dispute and draft its evidence pack.
 * The webhook or search result only says which dispute changed; the values we
 * store are always re-read from Braintree, so a late or forged payload cannot
 * set a status, amount or date.
 */
export async function upsertDispute(db: DB, rail: PaymentRail, hint: DisputeInfo, source: "webhook" | "reconcile", eventAt?: Date): Promise<Dispute | null> {
  let info: DisputeInfo;
  try {
    info = await rail.getDispute(hint.id);
  } catch {
    return null;
  }
  const m = await milestoneByTransaction(db, info.transactionId);
  if (!m) return null;
  const [existing] = await db.select().from(disputes).where(eq(disputes.id, info.id));
  if (existing) {
    if (eventAt && existing.lastEventAt && eventAt < existing.lastEventAt) return existing;
    const patch: Partial<Dispute> = { updatedAt: new Date(), ...(eventAt ? { lastEventAt: eventAt } : {}) };
    // A dispute that opened before there was a signed record gets its pack as soon as one exists.
    const redrafted = !existing.evidencePack && !existing.submittedAt ? draftPack(m) : null;
    if (redrafted) patch.evidencePack = redrafted;
    if (existing.status !== info.status) {
      patch.status = info.status;
      if (["won", "lost", "accepted", "expired", "auto_accepted"].includes(info.status)) patch.outcomeAt = new Date();
    }
    await db.update(disputes).set(patch).where(eq(disputes.id, info.id));
    if (redrafted) {
      await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "system", type: "dispute.pack_drafted", message: `Evidence pack drafted from the signed acceptance record for dispute ${info.id}`, data: { disputeId: info.id } });
    }
    if (patch.status) {
      await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "dispute.updated", message: `Dispute ${info.id} is now ${info.status.replace(/_/g, " ")}`, data: { disputeId: info.id, status: info.status, source } });
    }
    return getDisputeRow(db, info.id);
  }
  const pack = draftPack(m);
  await db
    .insert(disputes)
    .values({
      id: info.id,
      milestoneId: m.id,
      transactionId: info.transactionId,
      status: info.status,
      reason: info.reason,
      kind: info.kind,
      amountCents: info.amountCents,
      replyByDate: info.replyByDate,
      evidencePack: pack,
      lastEventAt: eventAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
  const p = await getProject(db, m.projectId);
  await audit(db, {
    projectId: m.projectId,
    milestoneId: m.id,
    actor: "braintree",
    type: "dispute.opened",
    message: `A ${info.kind ?? "dispute"} for ${money(info.amountCents, p.currency)} was opened (${(info.reason ?? "no reason").replace(/_/g, " ")}). ${pack ? "Evidence pack drafted from the signed acceptance record." : "There is no signed acceptance record yet, so no evidence pack was drafted."}`,
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
export const SANDBOX_WIN_MARKER = "compelling_evidence";

export async function approveAndSubmitDispute(db: DB, rail: PaymentRail, disputeId: string, editedPack?: string, opts: { sandboxMarkCompelling?: boolean } = {}): Promise<Dispute> {
  const d = await getDisputeRow(db, disputeId);
  const m = await getMilestone(db, d.milestoneId);
  if (d.submittedAt) throw new ServiceError("Evidence was already submitted for this dispute", 409);
  if (d.status !== "open") throw new ServiceError(`The dispute is ${d.status} and no longer takes evidence`, 409);
  if (!m.acceptanceRecord || !m.acceptanceSignature || !verifyRecord(m.acceptanceRecord, m.acceptanceSignature)) {
    throw new ServiceError("The acceptance record is missing or its signature does not verify", 409);
  }
  let pack = (editedPack ?? d.evidencePack ?? "").trim();
  if (!pack) throw new ServiceError("The evidence pack is empty");
  // Braintree's sandbox decides a dispute's outcome from a test value in the evidence. Sandbox and test rail only, and only when the operator ticks it.
  if (opts.sandboxMarkCompelling && rail.mode !== "production") pack = `${pack}\n${SANDBOX_WIN_MARKER}`;
  const now = new Date();
  // Claim the dispute so two quick clicks cannot submit evidence twice.
  const claim = await db
    .update(disputes)
    .set({ approvedAt: now, evidencePack: pack, updatedAt: now })
    .where(and(eq(disputes.id, d.id), isNull(disputes.approvedAt), isNull(disputes.submittedAt)));
  if (claim.rowsAffected !== 1) throw new ServiceError("Evidence for this dispute is already being submitted", 409);
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "operator", type: "dispute.evidence_approved", message: "Operator approved the evidence pack", data: { disputeId: d.id } });

  const ids: string[] = [];
  let final: DisputeInfo;
  try {
    const chunks = chunkEvidence(pack);
    for (const [i, c] of chunks.entries()) ids.push(await rail.addDisputeTextEvidence(d.id, c, i));
    final = await rail.finalizeDispute(d.id);
  } catch (err) {
    const e = err instanceof RailError ? err : new RailError(String(err));
    // Release the claim so the operator can try again, keeping any evidence ids Braintree already took.
    await db.update(disputes).set({ evidenceIds: ids, approvedAt: null, updatedAt: new Date() }).where(eq(disputes.id, d.id));
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "dispute.submit_failed", message: `Submitting evidence failed: ${e.message}`, data: { disputeId: d.id, code: e.code, evidenceIds: ids } });
    throw new ServiceError(e.message, 502);
  }
  await db
    .update(disputes)
    .set({ submittedAt: new Date(), evidenceIds: ids, status: final.status, updatedAt: new Date(), ...(["won", "lost"].includes(final.status) ? { outcomeAt: new Date() } : {}) })
    .where(eq(disputes.id, d.id));
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "dispute.evidence_submitted", message: `Submitted ${ids.length} evidence item(s) and finalized. Dispute is now ${final.status.replace(/_/g, " ")}.`, data: { disputeId: d.id, evidenceIds: ids, status: final.status } });
  return getDisputeRow(db, d.id);
}

/** Pull disputes for released milestones, for when no public webhook URL exists (local dev). */
export async function syncDisputes(db: DB, rail: PaymentRail, milestoneId: string) {
  const m = await getMilestone(db, milestoneId);
  const txns = [m.transactionId, m.disputeSimTransactionId].filter((t): t is string => !!t);
  const found: DisputeInfo[] = [];
  for (const t of txns) found.push(...(await rail.findDisputes(t)));
  for (const info of found) await upsertDispute(db, rail, info, "reconcile");
  return found;
}

export { STANDIN_EXPLANATION } from "./dispute-text";
import { STANDIN_EXPLANATION } from "./dispute-text";

/**
 * Sandbox simulation of the client's bank disputing a released milestone. Makes the stand-in
 * dispute-card charge for the same amount, records it on the milestone, and waits briefly for
 * Braintree to open the dispute (its dispute_opened webhook follows). Never in production.
 */
export async function simulateChargeback(db: DB, rail: PaymentRail, milestoneId: string, waitMs = 30_000): Promise<Dispute | null> {
  if (rail.mode === "production") throw new ServiceError("Chargeback simulation is sandbox only");
  const m = await getMilestone(db, milestoneId);
  if (m.state !== "released" || !m.acceptanceRecord) throw new ServiceError("A chargeback can be simulated only after the client has signed off and the payment was released", 409);
  if (m.disputeSimTransactionId) throw new ServiceError("A chargeback was already simulated for this milestone", 409);
  const t = await rail.chargeDisputeCard({ amountCents: m.settledCents || m.amountCents, orderId: `${m.id}-dispute`, description: `Chargeback simulation: ${m.title}` });
  const claimed = await db
    .update(milestones)
    .set({ disputeSimTransactionId: t.transactionId })
    .where(and(eq(milestones.id, m.id), isNull(milestones.disputeSimTransactionId)));
  if (claimed.rowsAffected !== 1) throw new ServiceError("A chargeback was already simulated for this milestone", 409);
  await audit(db, {
    projectId: m.projectId,
    milestoneId: m.id,
    actor: "operator",
    type: "sandbox.chargeback_simulated",
    message: `Sandbox simulation of the client's bank disputing this payment: a stand-in charge of ${money(t.amountCents, t.currency)} with Braintree's dispute test card (${t.status.replace(/_/g, " ")}). ${STANDIN_EXPLANATION.split(", so ")[0]}.`,
    data: { transactionId: t.transactionId, status: t.status },
  });
  const deadline = Date.now() + waitMs;
  for (;;) {
    const found = await rail.findDisputes(t.transactionId);
    if (found.length) return upsertDispute(db, rail, found[0], "reconcile");
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 2500));
  }
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
  // Insert first: the unique id is the lock, so two copies of one event cannot both run.
  const claimed = await db
    .insert(webhookEvents)
    .values({ id: eventId, eventType: event.kind, resourceId: event.subjectId, verified: true, payload: payload.slice(0, 20000), outcome: "processing", receivedAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (claimed.length === 0) return { status: 200, outcome: `duplicate of ${eventId}` };

  let outcome = "ignored";
  if (event.dispute) {
    const row = await upsertDispute(db, rail, event.dispute, "webhook", new Date(event.timestamp));
    outcome = row ? `dispute ${row.id} ${row.status}` : "dispute not found at Braintree or not tracked here";
  } else if (event.transaction) {
    const m = await milestoneByTransaction(db, event.transaction.transactionId);
    if (m) {
      const r = await reconcileMilestone(db, rail, m.id, "braintree");
      outcome = `reconciled: ${r.action}`;
    } else outcome = "transaction not tracked here";
  }
  await db.update(webhookEvents).set({ outcome }).where(eq(webhookEvents.id, eventId));
  return { status: 200, outcome };
}
