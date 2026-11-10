import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db";
import {
  checks,
  criteria,
  disputes,
  deliveries,
  milestones,
  projects,
  verdicts,
  type Milestone,
  type Project,
} from "../db/schema";
import {
  canTransition,
  remoteOutcome,
  revertClaim,
  holdHealth,
  isHoldActive,
  RENEWABLE,
  transition,
  type MilestoneEvent,
  type MilestoneState,
} from "../domain/milestone-machine";
import { RailError, type Hold, type PaymentRail } from "../payments/rail";
import { audit, type Actor } from "./audit";
import { canonicalJson, newId, newLinkSecret, shareToken, sign, verifyShareToken, verifySignature } from "./ids";

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

/** Client access: the project behind a valid, unrevoked share link. */
export async function projectFromShareLink(db: DB, projectId: string, token: string | null | undefined): Promise<Project> {
  const p = await getProject(db, projectId).catch(() => null);
  if (!p || !token || !verifyShareToken(p.id, p.linkSecret, token)) throw new ServiceError("This link is not valid", 403);
  return p;
}

export function shareTokenFor(p: Project): string {
  return shareToken(p.id, p.linkSecret);
}

/** Replaces the project's link secret. Every client link and receipt link sent before stops working. */
export async function rotateShareLink(db: DB, projectId: string) {
  await db.update(projects).set({ linkSecret: newLinkSecret() }).where(eq(projects.id, projectId));
  await audit(db, { projectId, actor: "operator", type: "link.rotated", message: "The client link was replaced. Old links no longer work." });
}

/** Operator access: the project must belong to the caller's workspace. */
export async function getOwnedProject(db: DB, workspaceId: string, projectId: string): Promise<Project> {
  const p = await getProject(db, projectId);
  if (p.workspaceId !== workspaceId) throw new ServiceError("Project not found", 404);
  return p;
}

export async function getOwnedMilestone(db: DB, workspaceId: string, milestoneId: string): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  await getOwnedProject(db, workspaceId, m.projectId);
  return m;
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
    // The state and the transaction both must be as read: a hold renewed in between is a conflict too.
    .where(and(eq(milestones.id, m.id), eq(milestones.state, from), m.transactionId ? eq(milestones.transactionId, m.transactionId) : isNull(milestones.transactionId)));
  if (res.rowsAffected !== 1) throw new ServiceError("This milestone changed while you were acting on it. Reload and try again.", 409);
  return { ...m, ...patch, state: to };
}

// ---------------------------------------------------------------- operator

export async function createProject(
  db: DB,
  input: { workspaceId: string; name: string; clientName: string; clientEmail?: string | null; scope: string; currency: string; isSample?: boolean; milestones: MilestoneDraft[] },
): Promise<Project> {
  const projectId = newId("prj");
  await db.insert(projects).values({
    id: projectId,
    workspaceId: input.workspaceId,
    linkSecret: newLinkSecret(),
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
    if (d.criteria.length > 10) throw new ServiceError(`Milestone ${i + 1} has more than 10 acceptance criteria`);
    if (d.criteria.some((c) => c.text.length > 400)) throw new ServiceError(`Keep each acceptance criterion in milestone ${i + 1} under 400 characters`);
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
  // Claim this funding attempt first, so two requests at once cannot both place a hold.
  const claim = await db
    .update(milestones)
    .set({ fundingAttempt: attempt })
    .where(and(eq(milestones.id, m.id), eq(milestones.fundingAttempt, m.fundingAttempt), eq(milestones.state, m.state)));
  if (claim.rowsAffected !== 1) throw new ServiceError("This milestone is already being funded. Reload to see the hold.", 409);
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
  // Trust Braintree's answer, not the request: only an authorized transaction is a hold.
  if (hold.status !== "authorized") {
    let voided = false;
    try {
      voided = (await rail.void(hold.transactionId)).status === "voided";
    } catch {
      voided = false;
    }
    const what = `Braintree returned ${hold.status.replace(/_/g, " ")} for ${hold.payerLabel ?? hold.instrument}, so the payment was charged at once instead of held`;
    if (voided) {
      await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "hold.not_held", message: `${what}. Signoff voided it, so nothing is charged.`, data: { transactionId: hold.transactionId, status: hold.status, rail: rail.mode } });
      throw new ServiceError("That card was charged at once instead of held, so the charge was voided and nothing is owed. Use a card that can be held, such as 4111 1111 1111 1111.", 402);
    }
    const attention = `${what}, and the void failed. Transaction ${hold.transactionId} may be charged. Check the Braintree control panel.`;
    await db.update(milestones).set({ attention }).where(eq(milestones.id, m.id));
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "hold.captured_not_held", message: attention, data: { transactionId: hold.transactionId, status: hold.status, rail: rail.mode } });
    throw new ServiceError("That card was charged at once instead of held, and the charge could not be voided automatically. The freelancer has been told.", 402);
  }
  let next: Milestone;
  try {
    next = await applyEvent(db, { ...m, fundingAttempt: attempt }, "AUTHORIZE", {
      transactionId: hold.transactionId,
    transactionStatus: hold.status,
    paymentInstrument: hold.instrument,
    payerLabel: hold.payerLabel,
    heldCents: hold.amountCents,
    authorizedAt: new Date(hold.createdAt ?? Date.now()),
      authExpiresAt: hold.authorizationExpiresAt ? new Date(hold.authorizationExpiresAt) : null,
    });
  } catch (err) {
    // The milestone moved on without this hold: release it rather than leave it on the card.
    await rail.void(hold.transactionId).catch(() => {});
    throw err;
  }
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

/**
 * Renews a live hold with the client's consent: a new authorization from the payment method the
 * client enters now, then a void of the old one, so the money is never unheld in between.
 * Braintree cannot extend an authorization, so this is the nearest honest thing.
 */
export async function renewHold(
  db: DB,
  rail: PaymentRail,
  milestoneId: string,
  input: { nonce: string; deviceData?: string },
): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  if (!RENEWABLE.includes(m.state as MilestoneState) || !m.transactionId) throw new ServiceError(`This milestone is ${m.state}, so there is no live hold to renew`, 409);
  if (m.disputeSimTransactionId) throw new ServiceError("This milestone already has a sandbox chargeback", 409);
  const old = m.transactionId;
  const attempt = m.fundingAttempt + 1;
  await db.update(milestones).set({ fundingAttempt: attempt }).where(eq(milestones.id, m.id));
  let hold: Hold;
  try {
    hold = await rail.authorize({ nonce: input.nonce, deviceData: input.deviceData, amountCents: m.heldCents || m.amountCents, orderId: `${m.id}-${attempt}`, description: m.title });
  } catch (err) {
    const e = err instanceof RailError ? err : new RailError(String(err));
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "hold.renew_failed", message: `The new hold was not placed: ${e.message}. The old hold is unchanged.`, data: { code: e.code, rail: rail.mode } });
    throw new ServiceError(`${e.message} The old hold is unchanged.`, 402);
  }
  const undo = async () => {
    try {
      await rail.void(hold.transactionId);
    } catch {}
  };
  if (hold.status !== "authorized") {
    await undo();
    throw new ServiceError("That card was charged at once instead of held, so the charge was voided. The old hold is unchanged.", 402);
  }
  const now = new Date();
  const swap = await db
    .update(milestones)
    .set({
      transactionId: hold.transactionId,
      transactionStatus: hold.status,
      paymentInstrument: hold.instrument,
      payerLabel: hold.payerLabel,
      heldCents: hold.amountCents,
      authorizedAt: new Date(hold.createdAt ?? Date.now()),
      authExpiresAt: hold.authorizationExpiresAt ? new Date(hold.authorizationExpiresAt) : null,
      updatedAt: now,
    })
    .where(and(eq(milestones.id, m.id), eq(milestones.transactionId, old), inArray(milestones.state, RENEWABLE)));
  if (swap.rowsAffected !== 1) {
    await undo();
    throw new ServiceError("The milestone changed while the hold was being renewed. The new hold was voided and the old one is unchanged.", 409);
  }
  let oldVoided = false;
  try {
    // Re-read first: void only a hold that is still just a hold, never a payment already released.
    if ((await rail.getHold(old)).status === "authorized") oldVoided = (await rail.void(old)).status === "voided";
  } catch {
    oldVoided = false;
  }
  if (!oldVoided) {
    await db.update(milestones).set({ attention: `The old hold ${old} could not be voided after the renewal. It is never charged and lapses on its own.` }).where(eq(milestones.id, m.id));
  }
  await audit(db, {
    projectId: m.projectId,
    milestoneId: m.id,
    actor: "client",
    type: "hold.renewed",
    message: `Client renewed the hold: ${money(hold.amountCents, hold.currency)} held again with ${hold.payerLabel ?? hold.instrument}${hold.authorizationExpiresAt ? ` until ${new Date(hold.authorizationExpiresAt).toISOString().slice(0, 10)}` : ""}. The old hold ${old} was ${oldVoided ? "voided" : "left to lapse"}. Not charged.`,
    data: { transactionId: hold.transactionId, previousTransactionId: old, oldVoided, expiresAt: hold.authorizationExpiresAt, rail: rail.mode },
  });
  return getMilestone(db, m.id);
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

/** Put a claimed milestone back where it was, clearing anything the failed attempt wrote. */
async function revert(db: DB, m: Milestone, clear: Partial<Milestone> = {}) {
  const to = revertClaim(m.state as MilestoneState, m.claimedFrom);
  await db
    .update(milestones)
    .set({ ...clear, state: to, claimedFrom: null, claimedAt: null, updatedAt: new Date() })
    .where(and(eq(milestones.id, m.id), eq(milestones.state, m.state)));
}

const CLEAR_ACCEPTANCE: Partial<Milestone> = { acceptedBy: null, acceptedAt: null, acceptanceRecord: null, acceptanceSignature: null };

/**
 * The client signs off and the money is released. Order matters:
 * 1. validate the amount;
 * 2. claim the milestone (in_review to releasing) and write the signed record
 *    in the same compare-and-set, so a racing decline or second sign-off loses
 *    before any money moves, and the record always matches the claim that won;
 * 3. call Braintree;
 * 4. settle the claim, or undo it if Braintree refused.
 */
export async function acceptAndRelease(
  db: DB,
  rail: PaymentRail,
  milestoneId: string,
  input: { signerName: string; amountCents?: number },
): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  if (m.state !== "in_review") throw new ServiceError("Only a delivery that is ready for sign-off can be released", 409);
  if (!m.transactionId) throw new ServiceError("No hold to release", 409);
  const signer = input.signerName.trim().slice(0, 120);
  if (signer.length < 2) throw new ServiceError("Type your name to sign off");
  const [openDispute] = await db.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.milestoneId, m.id), eq(disputes.status, "open")));
  if (openDispute) throw new ServiceError("A chargeback is open on this payment, so it cannot be released until the dispute is settled", 409);
  const amount = input.amountCents ?? m.heldCents;
  if (!Number.isInteger(amount) || amount <= 0 || amount > m.heldCents) {
    throw new ServiceError("Release amount must be a whole number of cents, above zero and no more than the hold");
  }

  const at = new Date();
  const record = await buildAcceptanceRecord(db, m, signer, amount, at);
  const { json, signature } = signRecord(record);
  const claimed = await applyEvent(db, m, "CLAIM_RELEASE", {
    claimedFrom: m.state,
    claimedAt: new Date(),
    acceptedBy: signer,
    acceptedAt: at,
    acceptanceRecord: json,
    acceptanceSignature: signature,
  });
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "client", type: "acceptance.signed", message: `${signer} signed off on "${m.title}"`, data: { signature: signature.slice(0, 16) } });

  let hold: Hold;
  try {
    hold = await rail.release(m.transactionId, amount === m.heldCents ? undefined : amount);
  } catch (err) {
    const e = err instanceof RailError ? err : new RailError(String(err));
    // The call may have gone through before the error; trust Braintree's answer.
    const now = await rail.getHold(m.transactionId).catch(() => null);
    if (!now || remoteOutcome(now.status) !== "released") {
      await revert(db, claimed, CLEAR_ACCEPTANCE);
      await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "release.failed", message: `Release failed, the sign-off was undone: ${e.message}`, data: { code: e.code, transactionId: m.transactionId } });
      throw new ServiceError(e.message, 502);
    }
    hold = now;
  }
  const receiptNumber = `SO-${at.getUTCFullYear()}-${m.id.slice(-6).toUpperCase()}`;
  const releasedPatch: Partial<Milestone> = {
    claimedFrom: null,
    claimedAt: null,
    transactionStatus: hold.status,
    settledCents: hold.amountCents,
    releasedAt: at,
    receiptNumber,
  };
  let next: Milestone;
  try {
    next = await applyEvent(db, claimed, "CAPTURE", releasedPatch);
  } catch (err) {
    // Braintree took the release, so the money moved. Whatever touched the claim
    // meanwhile, finish the release with this sign-off's record rather than lose it.
    if (!(err instanceof ServiceError) || err.status !== 409) throw err;
    await db
      .update(milestones)
      .set({ ...releasedPatch, state: "released", acceptedBy: signer, acceptedAt: at, acceptanceRecord: json, acceptanceSignature: signature, updatedAt: new Date() })
      .where(and(eq(milestones.id, m.id), inArray(milestones.state, ["releasing", "in_review"])));
    next = await getMilestone(db, m.id);
    if (next.state !== "released") throw err;
  }
  const partial = amount < m.heldCents;
  await audit(db, {
    projectId: m.projectId,
    milestoneId: m.id,
    actor: "braintree",
    type: "hold.released",
    message: partial
      ? `Released ${money(amount, hold.currency)} of ${money(m.heldCents, hold.currency)}. The rest of the hold drops off.`
      : `Released ${money(amount, hold.currency)} to the freelancer`,
    data: { transactionId: hold.transactionId, status: hold.status, receiptNumber },
  });
  return next;
}

export async function requestChanges(db: DB, milestoneId: string, note: string): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  if (note.trim().length < 3) throw new ServiceError("Say what needs to change");
  const next = await applyEvent(db, m, "REQUEST_CHANGES", { changeNote: note.trim().slice(0, 4000) });
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "client", type: "changes.requested", message: "Client asked for changes. The hold stays in place.", data: { note: note.trim().slice(0, 4000) } });
  return next;
}

/**
 * The client declines and the hold is voided. Claim first (to voiding), then
 * re-read the transaction and refuse unless it is still only authorized, so a
 * decline can never void money that a sign-off already released.
 */
export async function declineMilestone(db: DB, rail: PaymentRail, milestoneId: string, reason: string, actor: Actor = "client"): Promise<Milestone> {
  const m = await getMilestone(db, milestoneId);
  if (!canTransition(m.state as MilestoneState, "CLAIM_VOID")) throw new ServiceError(`A ${m.state.replace(/_/g, " ")} milestone cannot be declined`, 409);
  if (!m.transactionId) throw new ServiceError("No hold to release", 409);
  const claimed = await applyEvent(db, m, "CLAIM_VOID", { claimedFrom: m.state, claimedAt: new Date() });
  let hold: Hold;
  try {
    const before = await rail.getHold(m.transactionId);
    if (before.status !== "authorized") {
      throw new RailError(`The transaction is ${before.status.replace(/_/g, " ")}, so there is no hold to void`, "not_authorized", m.transactionId);
    }
    hold = await rail.void(m.transactionId);
  } catch (err) {
    const e = err instanceof RailError ? err : new RailError(String(err));
    const now = await rail.getHold(m.transactionId).catch(() => null);
    if (!now || now.status !== "voided") {
      await revert(db, claimed);
      await audit(db, { projectId: m.projectId, milestoneId: m.id, actor: "braintree", type: "void.failed", message: `Void failed, nothing changed: ${e.message}`, data: { code: e.code, transactionId: m.transactionId } });
      throw new ServiceError(e.message, 502);
    }
    hold = now;
  }
  const next = await applyEvent(db, claimed, "VOID", { claimedFrom: null, claimedAt: null, transactionStatus: hold.status, changeNote: reason.slice(0, 2000) || m.changeNote });
  await audit(db, { projectId: m.projectId, milestoneId: m.id, actor, type: "hold.voided", message: `Declined. The hold of ${money(m.heldCents, hold.currency)} was voided and nothing was charged.`, data: { transactionId: hold.transactionId, status: hold.status, reason } });
  return next;
}

// ---------------------------------------------------------------- reconcile

/** A claim younger than this belongs to a request that may still be talking to Braintree. */
export const CLAIM_GRACE_MS = 2 * 60 * 1000;

export type ReconcileResult = { milestoneId: string; local: string; remote: string | null; action: string };

/**
 * Compare local state with Braintree and repair drift. Safe to run any time.
 * - A claim left behind by a crash (releasing, voiding) is settled from what Braintree says.
 * - A hold that expired is marked expired.
 * - A disagreement only a person can resolve, such as released here but voided
 *   at Braintree, is flagged on the milestone and on the timeline, never papered over.
 */
export async function reconcileMilestone(db: DB, rail: PaymentRail, milestoneId: string, actor: Actor = "system"): Promise<ReconcileResult> {
  let m = await getMilestone(db, milestoneId);
  if (!m.transactionId) return { milestoneId, local: m.state, remote: null, action: "no hold" };
  const hold = await rail.getHold(m.transactionId);
  const remote = remoteOutcome(hold.status);
  let remoteStatus = hold.status;
  const state = m.state as MilestoneState;
  let action = "in sync";
  let attention: string | null = null;

  const claimAge = m.claimedAt ? Date.now() - m.claimedAt.getTime() : Number.POSITIVE_INFINITY;
  if ((state === "releasing" || state === "voiding") && claimAge < CLAIM_GRACE_MS) {
    action = `a ${state === "releasing" ? "sign-off" : "decline"} is in progress; left alone`;
  } else if (state === "releasing") {
    if (remote === "released") {
      m = await applyEvent(db, m, "CAPTURE", { claimedFrom: null, claimedAt: null, transactionStatus: hold.status, settledCents: hold.amountCents, releasedAt: m.acceptedAt ?? new Date(), receiptNumber: m.receiptNumber ?? `SO-${new Date().getUTCFullYear()}-${m.id.slice(-6).toUpperCase()}` });
      action = "finished an interrupted release";
    } else if (remote === "held") {
      await revert(db, m, CLEAR_ACCEPTANCE);
      action = "undid an interrupted sign-off; the hold is still in place";
    } else attention = `A sign-off was in progress but Braintree reports the transaction as ${hold.status}.`;
  } else if (state === "voiding") {
    if (remote === "voided") {
      m = await applyEvent(db, m, "VOID", { claimedFrom: null, claimedAt: null, transactionStatus: hold.status });
      action = "finished an interrupted decline";
    } else if (remote === "held") {
      await revert(db, m);
      action = "undid an interrupted decline; the hold is still in place";
    } else attention = `A decline was in progress but Braintree reports the transaction as ${hold.status}.`;
  } else if (state === "released" && remote !== "released") {
    attention = `This milestone is released here, but Braintree reports the transaction as ${hold.status}. The freelancer was not paid. Check the Braintree control panel.`;
  } else if (state === "declined" && remote === "released") {
    attention = `This milestone was declined here, but Braintree reports the transaction as ${hold.status}. The client may have been charged.`;
  } else if (isHoldActive(state) && (remote === "expired" || holdHealth(Date.now(), m.authExpiresAt?.getTime()) === "expired")) {
    if (canTransition(state, "EXPIRE")) {
      // Braintree flips an authorization to expired only when its batch runs; until then it can still be
      // captured. Void it before calling it expired, so a re-fund never leaves two live holds.
      let gone = remote === "expired";
      if (!gone) {
        try {
          gone = (await rail.void(m.transactionId!)).status === "voided";
        } catch {
          gone = false;
        }
      }
      if (gone) {
        if (remote !== "expired") remoteStatus = "voided";
        m = await applyEvent(db, m, "EXPIRE", { transactionStatus: remoteStatus });
        action = "hold expired";
      } else attention = `The hold passed its end date here, but Braintree still reports it as ${hold.status} and the void failed. Check the Braintree control panel.`;
    }
  } else if (isHoldActive(state) && remote !== "held") {
    attention = `The hold is active here, but Braintree reports the transaction as ${hold.status}.`;
  }

  const patch: Partial<Milestone> = {};
  if (remoteStatus !== m.transactionStatus) patch.transactionStatus = remoteStatus;
  if ((attention ?? null) !== (m.attention ?? null)) patch.attention = attention;
  if (Object.keys(patch).length) await db.update(milestones).set(patch).where(eq(milestones.id, m.id));
  if (attention) action = `needs attention: ${attention}`;
  else if (action === "in sync" && patch.transactionStatus) action = `status updated to ${hold.status}`;

  if (action !== "in sync") {
    await audit(db, { projectId: m.projectId, milestoneId: m.id, actor, type: attention ? "reconcile.mismatch" : "reconciled", message: attention ?? `Reconciled with Braintree: ${action}`, data: { transactionId: hold.transactionId, remote: hold.status } });
  }
  return { milestoneId, local: (await getMilestone(db, milestoneId)).state, remote: hold.status, action };
}

export async function reconcileProject(db: DB, rail: PaymentRail, projectId: string) {
  const out: ReconcileResult[] = [];
  for (const m of await projectMilestones(db, projectId)) out.push(await reconcileMilestone(db, rail, m.id, "operator"));
  return out;
}

export function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
