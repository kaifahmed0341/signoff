import { isHoldActive, type MilestoneState } from "../domain/milestone-machine";
import { when } from "./format";

/**
 * Rows for the audit grids on the project page, built on the server from the
 * audit events, milestones and disputes. Pure, so they are tested on their own.
 */

export type AuditKind = "Money" | "Dispute" | "Check" | "Delivery" | "Sign-off" | "Other";

export type TimelineRow = {
  id: string;
  iso: string;
  at: string;
  actor: string;
  milestone: string;
  kind: AuditKind;
  type: string;
  message: string;
  transactionId: string;
  disputeId: string;
  checkId: string;
  /** Anything else worth keeping from the event's data, as key=value pairs. */
  refs: string;
};

export function kindOf(type: string): AuditKind {
  if (type.startsWith("dispute.") || type === "sandbox.chargeback_simulated") return "Dispute";
  if (type.startsWith("hold.") || type.startsWith("release") || type.startsWith("void") || type.startsWith("reconcile")) return "Money";
  if (type.startsWith("check.")) return "Check";
  if (type.startsWith("delivery.") || type === "changes.requested") return "Delivery";
  if (type.startsWith("acceptance.")) return "Sign-off";
  return "Other";
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

type EventLike = { id: string; createdAt: Date; actor: string; milestoneId: string | null; type: string; message: string; data: Record<string, unknown> | null };

export function timelineRows(events: EventLike[], milestones: { id: string; title: string }[]): TimelineRow[] {
  return events.map((e) => {
    const d = e.data ?? {};
    const rest = ["status", "remote", "deliveryId", "receiptNumber", "code", "expiresAt"]
      .filter((k) => str(d[k]) !== "")
      .map((k) => `${k}=${k === "expiresAt" && typeof d[k] === "number" ? new Date(d[k] as number).toISOString().slice(0, 10) : str(d[k])}`)
      .join(" ");
    return {
      id: e.id,
      iso: e.createdAt.toISOString(),
      at: when(e.createdAt).replace(" UTC", ""),
      actor: e.actor === "operator" ? "freelancer" : e.actor,
      milestone: milestones.find((m) => m.id === e.milestoneId)?.title ?? "",
      kind: kindOf(e.type),
      type: e.type,
      message: e.message,
      transactionId: str(d.transactionId),
      disputeId: str(d.disputeId),
      checkId: str(d.checkId),
      refs: rest,
    };
  });
}

export type MoneyRow = {
  id: string;
  milestone: string;
  state: string;
  agreed: number;
  /** Authorized on the client's card and still active: held, not charged. */
  held: number;
  /** Submitted for settlement or settled: paid to the freelancer. */
  released: number;
  /** A hold that was voided or ran out: nothing charged. */
  voided: number;
  /** Amount under a chargeback, whatever its outcome. */
  disputed: number;
  transactionId: string;
  disputeId: string;
  disputeStatus: string;
};

type MilestoneLike = { id: string; title: string; state: string; amountCents: number; heldCents: number; settledCents: number; transactionId: string | null };
type DisputeLike = { id: string; milestoneId: string; status: string; amountCents: number };

export function moneyRows(milestones: MilestoneLike[], disputes: DisputeLike[]): MoneyRow[] {
  return milestones.map((m) => {
    const ds = disputes.filter((d) => d.milestoneId === m.id);
    return {
      id: m.id,
      milestone: m.title,
      state: m.state,
      agreed: m.amountCents,
      held: isHoldActive(m.state as MilestoneState) ? m.heldCents : 0,
      released: m.settledCents,
      voided: m.state === "declined" || m.state === "hold_expired" ? m.heldCents : 0,
      disputed: ds.reduce((a, d) => a + d.amountCents, 0),
      transactionId: m.transactionId ?? "",
      disputeId: ds.map((d) => d.id).join(" "),
      disputeStatus: ds.map((d) => d.status.replace(/_/g, " ")).join(", "),
    };
  });
}

export function moneyTotals(rows: MoneyRow[]): MoneyRow {
  const sum = (k: "agreed" | "held" | "released" | "voided" | "disputed") => rows.reduce((a, r) => a + r[k], 0);
  return { id: "total", milestone: "Total", state: "", agreed: sum("agreed"), held: sum("held"), released: sum("released"), voided: sum("voided"), disputed: sum("disputed"), transactionId: "", disputeId: "", disputeStatus: "" };
}
