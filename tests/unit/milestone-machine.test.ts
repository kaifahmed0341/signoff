import { describe, expect, it } from "vitest";
import {
  EXPIRY_WARNING_MS,
  IllegalTransitionError,
  MILESTONE_STATES,
  canTransition,
  eventForTransactionStatus,
  holdHealth,
  transition,
  type MilestoneEvent,
  type MilestoneState,
} from "@/lib/domain/milestone-machine";

describe("milestone state machine", () => {
  it("walks the happy path from draft to released", () => {
    const events: MilestoneEvent[] = ["SEND", "AUTHORIZE", "SUBMIT_DELIVERY", "CHECK_COMPLETE", "CAPTURE"];
    let s: MilestoneState = MILESTONE_STATES[0];
    for (const e of events) s = transition(s, e);
    expect(s).toBe("released");
  });

  it("supports a change request round trip", () => {
    let s = transition("in_review", "REQUEST_CHANGES");
    expect(s).toBe("changes_requested");
    s = transition(s, "SUBMIT_DELIVERY");
    expect(s).toBe("checking");
  });

  it("never captures without a review", () => {
    for (const s of ["draft", "awaiting_funding", "funded", "checking", "changes_requested"] as const) {
      expect(canTransition(s, "CAPTURE")).toBe(false);
      expect(() => transition(s, "CAPTURE")).toThrow(IllegalTransitionError);
    }
  });

  it("only voids while a hold is active", () => {
    expect(canTransition("funded", "VOID")).toBe(true);
    expect(canTransition("in_review", "VOID")).toBe(true);
    expect(canTransition("awaiting_funding", "VOID")).toBe(false);
    expect(canTransition("released", "VOID")).toBe(false);
  });

  it("allows refunding an expired hold", () => {
    expect(transition("funded", "EXPIRE")).toBe("hold_expired");
    expect(transition("hold_expired", "AUTHORIZE")).toBe("funded");
  });

  it("terminal states accept no events", () => {
    const all: MilestoneEvent[] = [
      "SEND", "AUTHORIZE", "SUBMIT_DELIVERY", "CHECK_COMPLETE", "CHECK_FAILED",
      "REQUEST_CHANGES", "CAPTURE", "VOID", "EXPIRE",
    ];
    for (const e of all) {
      expect(canTransition("released", e)).toBe(false);
      expect(canTransition("declined", e)).toBe(false);
    }
  });
});

describe("hold health", () => {
  const exp = 10 * 24 * 60 * 60 * 1000;
  it("is active well before expiry", () => {
    expect(holdHealth(0, exp)).toBe("active");
  });
  it("warns in the last day", () => {
    expect(holdHealth(exp - EXPIRY_WARNING_MS + 1, exp)).toBe("expiring_soon");
  });
  it("expires at the authorization expiry", () => {
    expect(holdHealth(exp, exp)).toBe("expired");
  });
  it("treats an unknown expiry as active", () => {
    expect(holdHealth(exp, null)).toBe("active");
  });
});

describe("Braintree status mapping", () => {
  it("maps transaction statuses to events", () => {
    expect(eventForTransactionStatus("submitted_for_settlement")).toBe("CAPTURE");
    expect(eventForTransactionStatus("settled")).toBe("CAPTURE");
    expect(eventForTransactionStatus("voided")).toBe("VOID");
    expect(eventForTransactionStatus("authorization_expired")).toBe("EXPIRE");
    expect(eventForTransactionStatus("authorized")).toBeNull();
  });
});
