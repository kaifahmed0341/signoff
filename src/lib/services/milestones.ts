import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import {
  checks,
  criteria,
  deliveries,
  milestones,
  projects,
  verdicts,
  type Milestone,
  type Project,
} from "../db/schema";
import {
  canTransition,
  eventForTransactionStatus,
  holdHealth,
  isHoldActive,
  transition,
  type MilestoneEvent,
  type MilestoneState,
} from "../domain/milestone-machine";
import { RailError, type Hold, type PaymentRail } from "../payments/rail";
import { audit, type Actor } from "./audit";
import { canonicalJson, newId, sign, verifySignature } from "./ids";

export class ServiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ServiceError";
  }
}

export type MilestoneDraft = {
  title: string;
  deliverable: string;
  amountCents: number;
  dueDate?: string | null;
  criteria: { text: string; sourceQuote: string; quoteVerified: boolean }[];
};

// ---------------------------------------------------------------- reads

export async function getProject(db: DB, projectId: string): Promise<Project> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new ServiceError("Project not found", 404);
  return p;
}

export async function getMilestone(db: DB, milestoneId: string): Promise<Milestone> {
  const [m] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!m) throw new ServiceError("Milestone not found", 404);
  return m;
}

export async function projectMilestones(db: DB, projectId: string) {
  return db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(asc(milestones.position));
}

export async function milestoneCriteria(db: DB, milestoneId: string) {
  return db.select().from(criteria).where(eq(criteria.milestoneId, milestoneId)).orderBy(asc(criteria.position));
}

export async function latestDelivery(db: DB, milestoneId: string) {
  const [d] = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.milestoneId, milestoneId))
    .orderBy(desc(deliveries.version))
    .limit(1);
  return d ?? null;
}

export async function latestCheck(db: DB, milestoneId: string) {
  const [c] = await db
    .select()
    .from(checks)
    .where(eq(checks.milestoneId, milestoneId))
    .orderBy(desc(checks.startedAt))
    .limit(1);
  return c ?? null;
}

// ---------------------------------------------------------------- state writes

/**
 * Move a milestone through the state machine with a compare-and-set on the
 * current state, so two clicks racing each other cannot both act.
 */
export async function applyEvent(
  db: DB,
  m: Milestone,
  event: MilestoneEvent,
  patch: Partial<Milestone> = {},
): Promise<Milestone> {
  const from = m.state as MilestoneState;
  const to = transition(from, event);
  const res = await db
    .update(milestones)
    .set({ ...patch, state: to, updatedAt: new Date() })
    .where(and(eq(milestones.id, m.id), eq(milestones.state, from)));
  if (res.rowsAffected !== 1) throw new ServiceError("This milestone changed while you were acting on it. Reload and try again.", 409);
  return { ...m, ...patch, state: to };
}

// ---------------------------------------------------------------- operator

export async function createProject(
  db: DB,
  input: { name: string; clientName: string; clientEmail?: string | null; scope: string; currency: string; isSample?: boolean; milestones: MilestoneDraft[] },
): Promise<Project> {
  const projectId = newId("prj");
  await db.insert(projects).values({
    id: projectId,
    name: input.name,
    clientName: input.clientName,
    clientEmail: input.clientEmail ?? null,
    scope: input.scope,
    currency: input.currency,
    isSample: input.isSample ?? false,
    createdAt: new Date(),
  });
  await replaceMilestones(db, projectId, input.milestones);
  await audit(db, { projectId, actor: "operator", type: "project.created", message: `Project "${input.name}" created with ${input.milestones.length} milestones` });
  return getProject(db, projectId);
}

export async function replaceMilestones(db: DB, projectId: string, drafts: MilestoneDraft[]) {
  const existing = await projectMilestones(db, projectId);
  if (existing.some((m) => m.state !== "draft")) throw new ServiceError("Milestones can only be edited before the project is sent");
  if (existing.length) await db.delete(milestones).where(inArray(milestones.id, existing.map((m) => m.id)));
  for (const [i, d] of drafts.entries()) {
    if (!Number.isInteger(d.amountCents) || d.amountCents <= 0) throw new ServiceError(`Milestone ${i + 1} needs an amount above zero`);
    if (d.criteria.length === 0) throw new ServiceError(`Milestone ${i + 1} needs at least one acceptance criterion`);
    const id = newId("ms");
    await db.insert(milestones).values({
      id,
      projectId,
      position: i,
      title: d.title,
      deliverable: d.deliverable,
      amountCents: d.amountCents,
      dueDate: d.dueDate ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const [j, c] of d.criteria.entries()) {
      await db.insert(criteria).values({ id: newId("cr"), milestoneId: id, position: j, text: c.text, sourceQuote: c.sourceQuote, quoteVerified: c.quoteVerified });
    }
  }
}

export async function sendProject(db: DB, projectId: string) {
  const ms = await projectMilestones(db, projectId);
  if (ms.length === 0) throw new ServiceError("Add at least one milestone before sending");
  for (const m of ms) if (m.state === "draft") await applyEvent(db, m, "SEND");
  await db.update(projects).set({ sentAt: new Date() }).where(eq(projects.id, projectId));
  await audit(db, { projectId, actor: "operator", type: "project.sent", message: "Share link sent to the client" });
}

// ---------------------------------------------------------------- client: fund

export async function fundMilestone(
  db: DB,
  rail: PaymentRail,
  milestoneId: string,
  input: { nonce: string; deviceData?: string },
): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  if (!canTransition(m.state as MilestoneState, "AUTHORIZE")) throw new ServiceError(`This milestone is ${m.state} and cannot be funded`, 409);
  const attempt = m.fundingAttempt + 1;
  await db.update(milestones).set({ fundingAttempt: attempt }).where(eq(milestones.id, m.id));
  let hold: Hold;
  try {
    hold = await rail.authorize({
      nonce: input.nonce,
      deviceData: input.deviceData,
      amountCents: m.amountCents,
      orderId: `${m.id}-${attempt}`,
      description: m.title,
    });
  } catch (err) {
    const e = err instanceof RailError ? err : new RailError(String(err));
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "hold.failed", message: `Hold was not placed: ${e.message}`, data: { code: e.code, transactionId: e.transactionId, rail: rail.mode } });
    throw new ServiceError(e.message, 402);
  }
  const next = await applyEvent(db, { ...m, fundingAttempt: attempt }, "AUTHORIZE", {
    transactionId: hold.transactionId,
    transactionStatus: hold.status,
    paymentInstrument: hold.instrument,
    payerLabel: hold.payerLabel,
    heldCents: hold.amountCents,
    authorizedAt: new Date(hold.createdAt ?? Date.now()),
    authExpiresAt: hold.authorizationExpiresAt ? new Date(hold.authorizationExpiresAt) : null,
  });
  await audit(db, {
    projectId: m.projectId,
    milestoneId: m.id,
    actor: "client",
    type: "hold.placed",
    message: `Client placed a hold of ${money(hold.amountCents, hold.currency)} with ${hold.payerLabel ?? hold.instrument}. Not charged.`,
    data: { transactionId: hold.transactionId, status: hold.status, expiresAt: hold.authorizationExpiresAt, orderId: `${m.id}-${attempt}`, rail: rail.mode },
  });
  return next;
}

// ---------------------------------------------------------------- client: decide

export type AcceptanceRecord = {
  version: 1;
  project: { id: string; name: string; client: string };
  milestone: { id: string; title: string; deliverable: string; amountCents: number; currency: string };
  transactionId: string;
  delivery: { id: string; version: number; links: string[]; submittedAt: string } | null;
  check: { id: string; model: string; finishedAt: string | null } | null;
  criteria: { text: string; sourceQuote: string; verdict: string | null; evidence: { source: string; quote: string }[] }[];
  signedOffBy: string;
  signedOffAt: string;
  releasedCents: number;
};

export async function buildAcceptanceRecord(db: DB, m: Milestone, signer: string, releasedCents: number, at: Date): Promise<AcceptanceRecord> {
  const p = await getProject(db, m.projectId);
  const crit = await milestoneCriteria(db, m.id);
  const d = await latestDelivery(db, m.id);
  const c = await latestCheck(db, m.id);
  const vs = c ? await db.select().from(verdicts).where(eq(verdicts.checkId, c.id)) : [];
  return {
    version: 1,
    project: { id: p.id, name: p.name, client: p.clientName },
    milestone: { id: m.id, title: m.title, deliverable: m.deliverable, amountCents: m.amountCents, currency: p.currency },
    transactionId: m.transactionId ?? "",
    delivery: d ? { id: d.id, version: d.version, links: d.links, submittedAt: d.createdAt.toISOString() } : null,
    check: c ? { id: c.id, model: c.model, finishedAt: c.finishedAt?.toISOString() ?? null } : null,
    criteria: crit.map((cr) => {
      const v = vs.find((x) => x.criterionId === cr.id);
      return { text: cr.text, sourceQuote: cr.sourceQuote, verdict: v?.verdict ?? null, evidence: v?.evidence ?? [] };
    }),
    signedOffBy: signer,
    signedOffAt: at.toISOString(),
    releasedCents,
  };
}

export function signRecord(record: AcceptanceRecord): { json: string; signature: string } {
  const json = canonicalJson(record);
  return { json, signature: sign("acceptance-record", json) };
}

export function verifyRecord(json: string, signature: string): boolean {
  return verifySignature("acceptance-record", json, signature);
}

export async function acceptAndRelease(
  db: DB,
  rail: PaymentRail,
  milestoneId: string,
  input: { signerName: string; amountCents?: number },
): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  if (m.state !== "in_review") throw new ServiceError("Only a delivery that is ready for sign-off can be released", 409);
  if (!m.transactionId) throw new ServiceError("No hold to release", 409);
  const signer = input.signerName.trim();
  if (signer.length < 2) throw new ServiceError("Type your name to sign off");
  const amount = input.amountCents ?? m.heldCents;
  if (amount <= 0 || amount > m.heldCents) throw new ServiceError("Release amount must be above zero and no more than the hold");

  const at = new Date();
  const record = await buildAcceptanceRecord(db, m, signer, amount, at);
  const { json, signature } = signRecord(record);
  // Record the sign-off before money moves, so the evidence exists even if the response is lost.
  await db
    .update(milestones)
    .set({ acceptedBy: signer, acceptedAt: at, acceptanceRecord: json, acceptanceSignature: signature })
    .where(eq(milestones.id, m.id));
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "client", type: "acceptance.signed", message: `${signer} signed off on "${m.title}"`, data: { signature: signature.slice(0, 16) } });

  let hold: Hold;
  try {
    hold = await rail.release(m.transactionId, amount === m.heldCents ? undefined : amount);
  } catch (err) {
    const e = err instanceof RailError ? err : new RailError(String(err));
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "release.failed", message: `Release failed: ${e.message}`, data: { code: e.code, transactionId: m.transactionId } });
    throw new ServiceError(e.message, 502);
  }
  const receiptNumber = `SO-${at.getUTCFullYear()}-${m.id.slice(-6).toUpperCase()}`;
  const next = await applyEvent(db, m, "CAPTURE", {
    transactionStatus: hold.status,
    settledCents: hold.amountCents,
    releasedAt: at,
    receiptNumber,
    acceptedBy: signer,
    acceptedAt: at,
    acceptanceRecord: json,
    acceptanceSignature: signature,
  });
  const partial = amount < m.heldCents;
  await audit(db, {
    projectId: m.projectId,
    milestoneId: m.id,
    actor: "braintree",
    type: "hold.released",
    message: partial
      ? `Released ${money(amount, hold.currency)} of ${money(m.heldCents, hold.currency)}. The rest of the hold drops off.`
      : `Released ${money(amount, hold.currency)} to the operator`,
    data: { transactionId: hold.transactionId, status: hold.status, receiptNumber },
  });
  return next;
}

export async function requestChanges(db: DB, milestoneId: string, note: string): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  if (note.trim().length < 3) throw new ServiceError("Say what needs to change");
  const next = await applyEvent(db, m, "REQUEST_CHANGES", { changeNote: note.trim() });
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "client", type: "changes.requested", message: "Client asked for changes. The hold stays in place.", data: { note: note.trim() } });
  return next;
}

export async function declineMilestone(db: DB, rail: PaymentRail, milestoneId: string, reason: string, actor: Actor = "client"): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  if (!canTransition(m.state as MilestoneState, "VOID")) throw new ServiceError(`A ${m.state} milestone cannot be declined`, 409);
  if (!m.transactionId) throw new ServiceError("No hold to release", 409);
  let hold: Hold;
  try {
    hold = await rail.void(m.transactionId);
  } catch (err) {
    const e = err instanceof RailError ? err : new RailError(String(err));
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "void.failed", message: `Void failed: ${e.message}`, data: { code: e.code, transactionId: m.transactionId } });
    throw new ServiceError(e.message, 502);
  }
  const next = await applyEvent(db, m, "VOID", { transactionStatus: hold.status, changeNote: reason || m.changeNote });
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor, type: "hold.voided", message: `Declined. The hold of ${money(m.heldCents, hold.currency)} was voided and nothing was charged.`, data: { transactionId: hold.transactionId, status: hold.status, reason } });
  return next;
}

// ---------------------------------------------------------------- reconcile

export type ReconcileResult = { milestoneId: string; local: string; remote: string | null; action: string };

/** Compare local state with Braintree and repair drift. Safe to run any time. */
export async function reconcileMilestone(db: DB, rail: PaymentRail, milestoneId: string, actor: Actor = "system"): Promise<ReconcileResult> {
  let m = await getMilestone(db, milestoneId);
  if (!m.transactionId) return { milestoneId, local: m.state, remote: null, action: "no hold" };
  const hold = await rail.getHold(m.transactionId);
  let action = "in sync";
  const event = eventForTransactionStatus(hold.status);
  const state = m.state as MilestoneState;
  if (event && canTransition(state, event)) {
    if (event === "CAPTURE" && state !== "in_review") {
      action = `remote is ${hold.status} but local is ${state}; flagged for review`;
    } else {
      m = await applyEvent(db, m, event, { transactionStatus: hold.status, settledCents: event === "CAPTURE" ? hold.amountCents : m.settledCents });
      action = `moved to ${m.state}`;
    }
  } else if (isHoldActive(state) && holdHealth(Date.now(), m.authExpiresAt?.getTime()) === "expired") {
    m = await applyEvent(db, m, "EXPIRE", { transactionStatus: "authorization_expired" });
    action = "hold expired locally";
  } else if (hold.status !== m.transactionStatus) {
    await db.update(milestones).set({ transactionStatus: hold.status, settledCents: event === "CAPTURE" ? hold.amountCents : m.settledCents }).where(eq(milestones.id, m.id));
    action = `status updated to ${hold.status}`;
  }
  if (action !== "in sync") {
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor, type: "reconciled", message: `Reconciled with Braintree: ${action}`, data: { transactionId: hold.transactionId, remote: hold.status } });
  }
  return { milestoneId, local: m.state, remote: hold.status, action };
}

export async function reconcileProject(db: DB, rail: PaymentRail, projectId: string) {
  const out: ReconcileResult[] = [];
  for (const m of await projectMilestones(db, projectId)) out.push(await reconcileMilestone(db, rail, m.id, "operator"));
  return out;
}

export function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
