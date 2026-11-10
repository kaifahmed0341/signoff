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
  "releasing", // claimed by a sign-off; the release call to Braintree is in flight
  "voiding", // claimed by a decline; the void call to Braintree is in flight
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
  | "CLAIM_RELEASE"
  | "CAPTURE"
  | "CLAIM_VOID"
  | "VOID"
  | "EXPIRE";

const HOLD_ACTIVE: MilestoneState[] = ["funded", "checking", "in_review", "changes_requested", "releasing", "voiding"];
/** States a decline may claim from. */
const VOIDABLE: MilestoneState[] = ["funded", "checking", "in_review", "changes_requested"];

const TABLE: Record<MilestoneEvent, { from: MilestoneState[]; to: MilestoneState }> = {
  SEND: { from: ["draft"], to: "awaiting_funding" },
  AUTHORIZE: { from: ["awaiting_funding", "hold_expired"], to: "funded" },
  SUBMIT_DELIVERY: { from: ["funded", "changes_requested"], to: "checking" },
  CHECK_COMPLETE: { from: ["checking"], to: "in_review" },
  CHECK_FAILED: { from: ["checking"], to: "funded" },
  REQUEST_CHANGES: { from: ["in_review"], to: "changes_requested" },
  // Money moves in two steps: claim the milestone, call Braintree, then settle
  // the claim. Only one claim can win, so a sign-off and a decline cannot both
  // reach Braintree.
  CLAIM_RELEASE: { from: ["in_review"], to: "releasing" },
  CAPTURE: { from: ["releasing"], to: "released" },
  CLAIM_VOID: { from: VOIDABLE, to: "voiding" },
  VOID: { from: ["voiding"], to: "declined" },
  EXPIRE: { from: VOIDABLE, to: "hold_expired" },
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

/** Where a failed claim goes back to. A void claim returns to the state it was taken from. */
export function revertClaim(state: MilestoneState, claimedFrom: string | null | undefined): MilestoneState {
  if (state === "releasing") return "in_review";
  if (state === "voiding" && claimedFrom && VOIDABLE.includes(claimedFrom as MilestoneState)) return claimedFrom as MilestoneState;
  if (state === "voiding") return "funded";
  throw new IllegalTransitionError(state, "VOID");
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
  in_review: "Checked, client to decide",
  releasing: "Releasing payment",
  voiding: "Releasing the hold",
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

/** A card authorization lasts about this long on Braintree; PayPal holds last longer. */
export const CARD_HOLD_DAYS = 7;

/** End of the due day, in ms, or null when there is no due date. */
export function dueEndMs(dueDate: string | null | undefined): number | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  return Date.parse(`${dueDate}T23:59:59Z`);
}

/** True when a hold that ends at `authExpiresAt` lapses before the milestone is due. */
export function holdEndsBeforeDue(authExpiresAt: number | null | undefined, dueDate: string | null | undefined): boolean {
  const due = dueEndMs(dueDate);
  return !!authExpiresAt && due !== null && authExpiresAt < due;
}

/** At funding time: a card hold placed now would lapse before the due date. */
export function cardHoldEndsBeforeDue(now: number, dueDate: string | null | undefined): boolean {
  return holdEndsBeforeDue(now + CARD_HOLD_DAYS * 24 * 60 * 60 * 1000, dueDate);
}

/** States in which the client can renew a live hold. */
export const RENEWABLE: MilestoneState[] = ["funded", "in_review", "changes_requested"];

export function holdHealth(now: number, authExpiresAt: number | null | undefined): HoldHealth {
  if (!authExpiresAt) return "active";
  if (now >= authExpiresAt) return "expired";
  if (authExpiresAt - now <= EXPIRY_WARNING_MS) return "expiring_soon";
  return "active";
}

export type RemoteOutcome = "released" | "voided" | "expired" | "held" | "other";

/** What a Braintree transaction status means for the money. */
export function remoteOutcome(status: string): RemoteOutcome {
  switch (status) {
    case "submitted_for_settlement":
    case "settling":
    case "settlement_pending":
    case "settlement_confirmed":
    case "settled":
      return "released";
    case "voided":
      return "voided";
    case "authorization_expired":
      return "expired";
    case "authorized":
      return "held";
    default:
      return "other";
  }
}

/** Client-facing labels: the client paid, the freelancer was paid. */
export const CLIENT_STATE_LABEL: Partial<Record<MilestoneState, string>> = {
  released: "Paid",
  funded: "Funded, money held",
  awaiting_funding: "Fund to start",
  in_review: "Checked, your decision",
};
