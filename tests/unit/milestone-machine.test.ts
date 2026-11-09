import { describe, expect, it } from "vitest";
import {
  AUTH_VALIDITY_MS,
  HONOR_PERIOD_MS,
  IllegalTransitionError,
  MILESTONE_STATES,
  canTransition,
  eventForAuthorizationStatus,
  holdHealth,
  transition,
  type MilestoneEvent,
} from "@/lib/domain/milestone-machine";

describe("milestone state machine", () => {
  it("walks the happy path from draft to released", () => {
    const events: MilestoneEvent[] = ["SEND", "AUTHORIZE", "SUBMIT_DELIVERY", "CHECK_COMPLETE", "CAPTURE"];
    let s = MILESTONE_STATES[0];
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
  const start = 1_000_000;
  const honor = start + HONOR_PERIOD_MS;
  const exp = start + AUTH_VALIDITY_MS;
  it("is guaranteed for three days", () => {
    expect(holdHealth(start + 1000, honor, exp)).toBe("guaranteed");
  });
  it("recommends reauthorizing after the honor period", () => {
    expect(holdHealth(honor + 1, honor, exp)).toBe("valid_reauthorize_recommended");
  });
  it("expires at 29 days", () => {
    expect(holdHealth(exp, honor, exp)).toBe("expired");
  });
});

describe("PayPal status mapping", () => {
  it("maps authorization statuses to events", () => {
    expect(eventForAuthorizationStatus("CAPTURED")).toBe("CAPTURE");
    expect(eventForAuthorizationStatus("VOIDED")).toBe("VOID");
    expect(eventForAuthorizationStatus("EXPIRED")).toBe("EXPIRE");
    expect(eventForAuthorizationStatus("CREATED")).toBeNull();
  });
});
