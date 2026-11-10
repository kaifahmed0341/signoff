import { describe, expect, it } from "vitest";
import { kindOf, moneyRows, moneyTotals, timelineRows } from "@/lib/web/audit";

describe("audit grid rows", () => {
  it("puts the Braintree transaction, dispute and check ids in their own columns", () => {
    const [r] = timelineRows(
      [{ id: "ev1", createdAt: new Date("2026-11-10T10:00:00Z"), actor: "operator", milestoneId: "m1", type: "dispute.opened", message: "Chargeback opened", data: { transactionId: "tx9", disputeId: "dp3", status: "open", replyBy: "2026-11-20" } }],
      [{ id: "m1", title: "Landing page" }],
    );
    expect(r).toMatchObject({ id: "ev1", actor: "freelancer", milestone: "Landing page", kind: "Dispute", transactionId: "tx9", disputeId: "dp3", checkId: "", refs: "status=open" });
  });

  it("sorts events into kinds the chips filter on", () => {
    expect(kindOf("hold.placed")).toBe("Money");
    expect(kindOf("reconcile.mismatch")).toBe("Money");
    expect(kindOf("sandbox.chargeback_simulated")).toBe("Dispute");
    expect(kindOf("check.completed")).toBe("Check");
    expect(kindOf("acceptance.signed")).toBe("Sign-off");
    expect(kindOf("changes.requested")).toBe("Delivery");
    expect(kindOf("project.created")).toBe("Other");
  });

  it("counts money as held only while the hold is active, voided after a decline or expiry, and disputed per dispute", () => {
    const rows = moneyRows(
      [
        { id: "a", title: "A", state: "funded", amountCents: 45000, heldCents: 45000, settledCents: 0, transactionId: "t1" },
        { id: "b", title: "B", state: "released", amountCents: 60000, heldCents: 60000, settledCents: 60000, transactionId: "t2" },
        { id: "c", title: "C", state: "declined", amountCents: 20000, heldCents: 20000, settledCents: 0, transactionId: "t3" },
        { id: "d", title: "D", state: "hold_expired", amountCents: 10000, heldCents: 10000, settledCents: 0, transactionId: null },
      ],
      [{ id: "dp1", milestoneId: "b", status: "under_review", amountCents: 60000 }],
    );
    expect(rows.map((r) => [r.held, r.released, r.voided, r.disputed])).toEqual([
      [45000, 0, 0, 0],
      [0, 60000, 0, 60000],
      [0, 0, 20000, 0],
      [0, 0, 10000, 0],
    ]);
    expect(rows[1]).toMatchObject({ disputeId: "dp1", disputeStatus: "under review" });
    expect(moneyTotals(rows)).toMatchObject({ milestone: "Total", agreed: 135000, held: 45000, released: 60000, voided: 30000, disputed: 60000 });
  });
});
