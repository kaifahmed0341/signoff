import { notFound } from "next/navigation";
import { Logo } from "@/components/app/brand";
import { PrintButton } from "./print-button";
import { getDb } from "@/lib/db";
import { getMilestone, projectFromShareLink, verifyRecord, type AcceptanceRecord } from "@/lib/services/milestones";
import { money, when } from "@/lib/web/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt", robots: { index: false } };

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const db = await getDb();
  const m = await getMilestone(db, id).catch(() => notFound());
  const p = await projectFromShareLink(db, m.projectId, t).catch(() => notFound());
  if (m.state !== "released" || !m.acceptanceRecord) notFound();
  const record = JSON.parse(m.acceptanceRecord) as AcceptanceRecord;
  const valid = verifyRecord(m.acceptanceRecord, m.acceptanceSignature ?? "");

  return (
    <div className="min-h-screen bg-muted/40 py-10 px-4">
      <div className="mx-auto max-w-2xl bg-card border rounded-2xl shadow-sm p-5 sm:p-8 print:shadow-none print:border-0">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2"><Logo /><span className="font-semibold">Signoff receipt</span></div>
          <div className="text-right text-sm">
            <div className="font-mono">{m.receiptNumber}</div>
            <div className="text-muted-foreground">{when(m.releasedAt)}</div>
          </div>
        </div>
        <div className="mt-8 grid sm:grid-cols-2 gap-6 text-sm">
          <div><div className="text-xs text-muted-foreground">Client</div><div className="font-medium">{p.clientName}</div></div>
          <div><div className="text-xs text-muted-foreground">Project</div><div className="font-medium">{p.name}</div></div>
        </div>
        <table className="mt-8 w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Milestone</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            <tr className="border-b"><td className="py-3"><div className="font-medium">{m.title}</div><div className="text-muted-foreground">{m.deliverable}</div></td><td className="py-3 text-right tabular-nums">{money(m.settledCents, p.currency)}</td></tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="py-3 font-semibold">{m.transactionStatus === "settled" ? "Paid" : "Released for payment"}</td>
              <td className="py-3 text-right font-semibold tabular-nums">{money(m.settledCents, p.currency)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="mt-6 grid sm:grid-cols-2 gap-4 text-xs text-muted-foreground">
          <div>
            Paid with {m.payerLabel ?? m.paymentInstrument} through Braintree, a PayPal service.{" "}
            {m.transactionStatus === "settled" ? "The payment has settled." : `Braintree status: ${(m.transactionStatus ?? "").replace(/_/g, " ")}. Settlement usually completes within a day.`}
          </div>
          <div className="sm:text-right font-mono">Transaction {m.transactionId}</div>
        </div>
        <div className="mt-8 rounded-xl border p-4 text-sm">
          <div className="font-medium">Acceptance record</div>
          <p className="mt-1 text-muted-foreground">Signed off by {record.signedOffBy} at {when(new Date(record.signedOffAt))} after reviewing delivery v{record.delivery?.version}.</p>
          <ul className="mt-3 space-y-1">
            {record.criteria.map((c, i) => (
              <li key={i} className="flex gap-2"><span className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{(c.verdict ?? "not checked").replace("_", " ")}</span><span>{c.text}</span></li>
            ))}
          </ul>
          <div className="mt-3 text-xs font-mono break-all text-muted-foreground">Signature {m.acceptanceSignature} {valid ? "(verified)" : "(does not verify)"}</div>
        </div>
        <div className="mt-8 no-print"><PrintButton /></div>
      </div>
    </div>
  );
}
