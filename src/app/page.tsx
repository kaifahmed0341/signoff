import Link from "next/link";
import { ArrowRight, Ban, FileSearch, Lock, PlayCircle, Quote, Scale, ShieldCheck, Undo2 } from "lucide-react";
import { Brand } from "@/components/app/brand";
import { Button, buttonVariants } from "@/components/ui/button";
import { env } from "@/lib/env";
import { currentWorkspace } from "@/lib/web/auth";
import { startDemo } from "./actions";
import { workspaceLimitMessage } from "@/lib/services/workspaces";

export const dynamic = "force-dynamic";

const steps = [
  {
    icon: FileSearch,
    title: "Scope to milestones",
    body: "Paste the agreed scope. The AI drafts milestones with checkable acceptance criteria, and each criterion quotes the sentence in the scope behind it.",
  },
  {
    icon: Lock,
    title: "Money held, not charged",
    body: "The client funds a milestone with PayPal or a card. It is an authorization: the money is reserved and nothing is charged until they sign off.",
  },
  {
    icon: ShieldCheck,
    title: "Evidence, not opinions",
    body: "On delivery, a checker reads the site, files or repository and marks each criterion met, not met or needs a person, quoting what it found.",
  },
  {
    icon: Undo2,
    title: "Sign off or send back",
    body: "The client releases the money with one signature, asks for changes with a note drafted from the failures, or declines and the hold is voided.",
  },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ limit?: string }> }) {
  const e = env();
  const { limit } = await searchParams;
  const workspace = await currentWorkspace();
  const primary = workspace ? (
    <Link href="/dashboard" className={buttonVariants({ size: "lg", className: "h-11 px-5 text-base" })}>
      Open your workspace <ArrowRight />
    </Link>
  ) : e.DEMO_MODE ? (
    <form action={startDemo}>
      <Button type="submit" size="lg" className="h-11 px-5 text-base">
        Try the live demo <ArrowRight />
      </Button>
    </form>
  ) : (
    <Link href="/login" className={buttonVariants({ size: "lg", className: "h-11 px-5 text-base" })}>
      Open the operator console <ArrowRight />
    </Link>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto w-full max-w-6xl px-4 h-16 flex items-center gap-4">
        <Brand />
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <a href={e.REPO_URL} className="text-muted-foreground hover:text-foreground">GitHub</a>
          {!e.DEMO_MODE && !workspace && <Link href="/login" className="text-muted-foreground hover:text-foreground">Sign in</Link>}
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pt-10 sm:pt-16 pb-12 grid lg:grid-cols-[1.15fr_1fr] gap-12 items-center">
          <div>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08]">
              Get paid the moment your client accepts the work.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-xl">
              Signoff holds the client&apos;s money up front, has an AI check the delivery against what you both agreed, and releases the money when the client signs off.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {primary}
              {e.DEMO_VIDEO_URL && (
                <a href={e.DEMO_VIDEO_URL} className={buttonVariants({ size: "lg", variant: "outline", className: "h-11 px-5 text-base" })}>
                  <PlayCircle /> Watch the 3 minute demo
                </a>
              )}
            </div>
            {e.DEMO_MODE && !workspace && limit !== "workspaces" && (
              <p className="mt-3 text-sm text-muted-foreground">No sign-up. You get a private demo workspace with a sample project. Sandbox money only.</p>
            )}
            {limit === "workspaces" && !workspace && (
              <p className="mt-3 text-sm text-amber-800 dark:text-amber-300" role="status">
                {workspaceLimitMessage()}
              </p>
            )}
          </div>
          <HeroCard />
        </section>

        <section className="border-y bg-card">
          <div className="mx-auto max-w-6xl px-4 py-10 grid md:grid-cols-[1fr_1fr_1.2fr] gap-8 items-start">
            <Stat value="71%" label="of US freelancers surveyed had trouble getting paid at some point in their career." />
            <Stat value="1 in 2" label="had trouble collecting payment in the year before the survey, 2014." />
            <div className="text-sm text-muted-foreground">
              <p>
                Clients will not send a deposit to someone they just met, and freelancers chase invoices for work that is already done. A payment hold fixes the first half. Signoff adds a fair, fast way to decide the work is accepted.
              </p>
              <p className="mt-3 text-xs">
                Source:{" "}
                <a className="underline" href="https://onlabor.org/wp-content/uploads/2017/05/FU_NonpaymentReport_r3.pdf">
                  Freelancers Union, The Costs of Nonpayment
                </a>
                , survey of 5,358 US freelancers, July 2015.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-xl border bg-card p-5">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-secondary text-sm font-semibold text-primary">{i + 1}</span>
                  <s.icon className="size-5 text-primary" />
                </div>
                <h3 className="mt-4 font-medium">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-card p-6">
            <div className="flex items-center gap-2 font-medium"><Ban className="size-5 text-primary" /> The AI cannot move money</div>
            <p className="mt-2 text-sm text-muted-foreground">The checker&apos;s tools only read. Money moves only when a person clicks: the client signing off or declining, or the operator approving dispute evidence.</p>
          </div>
          <div className="rounded-xl border bg-card p-6">
            <div className="flex items-center gap-2 font-medium"><Quote className="size-5 text-primary" /> Every quote is checked in code</div>
            <p className="mt-2 text-sm text-muted-foreground">A quote must appear word for word in what visitors can see, and must contain the names and numbers the criterion asks for. Invented, hidden or off-point quotes are removed, and delivered pages are treated as data, never as instructions.</p>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="rounded-xl border bg-card p-6 grid md:grid-cols-[220px_1fr] gap-4">
            <div className="flex items-center gap-2 font-medium h-fit"><Scale className="size-5 text-primary" /> Who holds the money</div>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                The hold sits in the freelancer&apos;s own Braintree account, so a freelancer could still capture it from the Braintree control panel without the client&apos;s sign-off. Signoff does not make cheating impossible.
              </p>
              <p>
                What it gives both sides is an agreed test of done, a record they both signed, and evidence ready for a dispute if either side breaks the deal. A production version would keep the right to capture on a neutral platform account, such as PayPal&apos;s marketplace and platform payments, so neither side can move the money alone.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span>Payments run on Braintree, a PayPal service.</span>
          <span>Open source, MIT licence.</span>
          <a className="hover:text-foreground" href={e.REPO_URL}>Source code</a>
          <span className="sm:ml-auto">Built for the PayPal AI Hackathon.</span>
        </div>
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-4xl font-semibold tracking-tight text-primary">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function HeroCard() {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Milestone 1 of 2</div>
          <div className="mt-1 font-medium">Landing page</div>
        </div>
        <span className="rounded-full bg-indigo-100 text-indigo-900 px-2.5 py-0.5 text-xs font-medium">Ready for sign-off</span>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-semibold">$450.00</span>
        <span className="text-sm text-held">held, not charged</span>
      </div>
      <ul className="mt-5 space-y-2 text-sm">
        <li className="flex gap-3"><span className="text-met font-medium w-16 shrink-0">Met</span> Headline names the studio</li>
        <li className="flex gap-3"><span className="text-met font-medium w-16 shrink-0">Met</span> Waitlist signup form</li>
        <li className="flex gap-3"><span className="text-unmet font-medium w-16 shrink-0">Not met</span> Saturday class start time</li>
        <li className="flex gap-3"><span className="text-unmet font-medium w-16 shrink-0">Not met</span> Studio address</li>
      </ul>
      <div className="mt-5 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        From the delivered page: &ldquo;Saturday wheel-throwing (schedule coming soon)&rdquo;
      </div>
    </div>
  );
}
