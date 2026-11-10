import Link from "next/link";
import { Eye } from "lucide-react";
import { Brand } from "@/components/app/brand";
import { workspaceLimitMessage } from "@/lib/services/workspaces";

export const dynamic = "force-dynamic";
export const metadata = { title: "A finished run" };

const STEPS: { file: string; title: string; text: string }[] = [
  { file: "01-project", title: "1. The freelancer's project", text: "Tidewell Studio is building a website for Quarrymoor Bakehouse. Each milestone has acceptance criteria drafted from the scope, each with the scope sentence it came from." },
  { file: "02-client-fund", title: "2. The client places a hold", text: "The bakery funds milestone 1 by card through the Braintree Drop-in. The money is authorized and held, not charged." },
  { file: "03-report-cheat", title: "3. A cheat is caught", text: "The first delivery hides the class time and address from visitors and plants a note for the AI. The checker lists both as tampering and does not accept hidden text as proof." },
  { file: "04-client-accept", title: "4. The client signs off", text: "After a change request, the second delivery meets all four criteria, each with a quote found word for word on the page. The client types a name and releases the payment." },
  { file: "05-receipt", title: "5. The signed acceptance record", text: "Sign-off writes a record of the criteria, the evidence the client saw, the signer and the time, signed so any change shows." },
  { file: "06-dispute", title: "6. A chargeback, answered from the record", text: "A real Braintree sandbox dispute opens after sign-off. The evidence pack is drafted from the signed record, the freelancer approves it, it goes to Braintree's Disputes API, and the sandbox rules it won." },
  { file: "11-money-1280", title: "7. Money and audit in AG Grid", text: "What was held, released and disputed per milestone, and every Braintree transaction and dispute id on the audit timeline." },
  { file: "10-new-project", title: "8. Your own project", text: "In a live workspace you paste your own scope and the AI drafts milestones and criteria from it." },
];

export default async function FinishedRun({ searchParams }: { searchParams: Promise<{ limit?: string }> }) {
  const { limit } = await searchParams;
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-4xl px-4 h-14 flex items-center gap-4">
          <Brand />
          <Link href="/" className="ml-auto text-sm text-muted-foreground hover:text-foreground">Front page</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8 min-w-0">
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-4 text-sm text-amber-900 dark:text-amber-200 flex gap-3">
          <Eye className="size-5 shrink-0 mt-0.5" />
          <div>
            <strong>Read-only: a finished run, not a live workspace.</strong> These are screens from one complete run of the loop on the hosted demo and the live Braintree sandbox, recorded on 10 November 2026. Nothing here can be clicked.
            {limit === "workspaces" && <p className="mt-2">{workspaceLimitMessage()}</p>}
          </div>
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">The whole loop, start to finish</h1>
        <div className="mt-8 space-y-10">
          {STEPS.map((s) => (
            <section key={s.file}>
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
              <div className="mt-3 max-h-[70vh] overflow-y-auto rounded-xl border bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/finished-run/${s.file}.png`} alt={s.title} className="w-full h-auto" loading="lazy" />
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
