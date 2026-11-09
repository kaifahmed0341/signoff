/**
 * Milestone lifecycle. Pure and side-effect free so it can be tested on its
 * own. Services call `transition()` before every write, so an illegal move
 * (say, capturing a milestone that was never reviewed) fails loudly instead of
 * moving money.
 */

export const MILESTONE_STATES = [
  "draft", // operator is still editing
  "awaiting_funding", // share link sent, client has not approved a hold
  "funded", // Braintree authorization active, money held not charged
  "checking", // delivery submitted, checker agent running
  "in_review", // evidence report ready, client decides
  "changes_requested", // client asked for changes, hold still active
  "released", // transaction submitted for settlement, operator paid
  "declined", // authorization voided, hold released
  "hold_expired", // authorization expired before a decision
] as const;

export type MilestoneState = (typeof MILESTONE_STATES)[number];

export type MilestoneEvent =
  | "SEND"
  | "AUTHORIZE"
  | "SUBMIT_DELIVERY"
  | "CHECK_COMPLETE"
  | "CHECK_FAILED"
  | "REQUEST_CHANGES"
  | "CAPTURE"
  | "VOID"
  | "EXPIRE";

const HOLD_ACTIVE: MilestoneState[] = ["funded", "checking", "in_review", "changes_requested"];

const TABLE: Record<MilestoneEvent, { from: MilestoneState[]; to: MilestoneState }> = {
  SEND: { from: ["draft"], to: "awaiting_funding" },
  AUTHORIZE: { from: ["awaiting_funding", "hold_expired"], to: "funded" },
  SUBMIT_DELIVERY: { from: ["funded", "changes_requested"], to: "checking" },
  CHECK_COMPLETE: { from: ["checking"], to: "in_review" },
  CHECK_FAILED: { from: ["checking"], to: "funded" },
  REQUEST_CHANGES: { from: ["in_review"], to: "changes_requested" },
  CAPTURE: { from: ["in_review"], to: "released" },
  VOID: { from: HOLD_ACTIVE, to: "declined" },
  EXPIRE: { from: HOLD_ACTIVE, to: "hold_expired" },
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly state: MilestoneState,
    public readonly event: MilestoneEvent,
  ) {
    super(`Cannot ${event} a milestone that is ${state}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition(state: MilestoneState, event: MilestoneEvent): boolean {
  return TABLE[event].from.includes(state);
}

export function transition(state: MilestoneState, event: MilestoneEvent): MilestoneState {
  if (!canTransition(state, event)) throw new IllegalTransitionError(state, event);
  return TABLE[event].to;
}

export function isHoldActive(state: MilestoneState): boolean {
  return HOLD_ACTIVE.includes(state);
}

export function isTerminal(state: MilestoneState): boolean {
  return state === "released" || state === "declined";
}

export const STATE_LABEL: Record<MilestoneState, string> = {
  draft: "Draft",
  awaiting_funding: "Awaiting funding",
  funded: "Funded, money held",
  checking: "Checking delivery",
  in_review: "Ready for sign-off",
  changes_requested: "Changes requested",
  released: "Released to you",
  declined: "Declined, hold released",
  hold_expired: "Hold expired",
};

/**
 * A Braintree authorization carries its own expiry (`authorizationExpiresAt`):
 * about 7 days for most cards, longer for PayPal. We warn a day ahead so the
 * client can be asked to sign off or re-fund before the hold lapses.
 */
export const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;

export type HoldHealth = "active" | "expiring_soon" | "expired";

export function holdHealth(now: number, authExpiresAt: number | null | undefined): HoldHealth {
  if (!authExpiresAt) return "active";
  if (now >= authExpiresAt) return "expired";
  if (authExpiresAt - now <= EXPIRY_WARNING_MS) return "expiring_soon";
  return "active";
}

/** Map a Braintree transaction status to the event that brings local state in line. */
export function eventForTransactionStatus(status: string): MilestoneEvent | null {
  switch (status) {
    case "submitted_for_settlement":
    case "settling":
    case "settlement_pending":
    case "settlement_confirmed":
    case "settled":
      return "CAPTURE";
    case "voided":
      return "VOID";
    case "authorization_expired":
      return "EXPIRE";
    default:
      return null;
  }
}
