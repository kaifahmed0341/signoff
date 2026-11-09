import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileSearch, Lock, ShieldCheck, Undo2 } from "lucide-react";
import { Brand } from "@/components/app/brand";
import { buttonVariants } from "@/components/ui/button";
import { isOperator } from "@/lib/web/auth";

export const dynamic = "force-dynamic";

const steps = [
  { icon: FileSearch, title: "Scope to milestones", body: "Paste the scope. The AI drafts milestones with checkable acceptance criteria, each tied to the exact sentence in the scope that justifies it." },
  { icon: Lock, title: "Money held, not charged", body: "The client funds each milestone with PayPal or a card through Braintree. It is an authorization: nothing is charged until they sign off." },
  { icon: ShieldCheck, title: "Evidence, not vibes", body: "When work is delivered, a checker reads the site, files or repository and reports met, not met or needs a person, quoting what it found. Every quote is verified in code." },
  { icon: Undo2, title: "Sign off or send back", body: "The client accepts and releases the money, asks for changes with a note drafted from the failing criteria, or declines and the hold is voided." },
];

export default async function Home() {
  if (await isOperator()) redirect("/dashboard");
  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto w-full max-w-6xl px-4 h-16 flex items-center">
        <Brand />
        <Link href="/login" className={buttonVariants({ variant: "outline", className: "ml-auto" })}>Operator sign in</Link>
      </header>
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 grid lg:grid-cols-[1.2fr_1fr] gap-12 items-center">
          <div>
            <p className="text-sm font-medium text-primary mb-4">Open source. Runs on Braintree, a PayPal service.</p>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">Get paid when the work is accepted. Not weeks later.</h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl">
              Clients will not send a deposit to someone they just met. Freelancers spend weeks chasing invoices for finished work. Signoff holds the client&apos;s money
              up front, checks the delivery against what was agreed, and releases it the moment the client signs off.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className={buttonVariants({ size: "lg" })}>
                Open the operator console <ArrowRight />
              </Link>
              <a href="https://github.com/kaifahmed0341/signoff" className={buttonVariants({ size: "lg", variant: "outline" })}>Source on GitHub</a>
            </div>
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Milestone 1 of 2</div>
            <div className="mt-1 font-medium">Landing page</div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-semibold">$450.00</span>
              <span className="text-sm text-held">held, not charged</span>
            </div>
            <ul className="mt-5 space-y-2 text-sm">
              <li className="flex gap-2"><span className="text-met font-medium w-16">Met</span> Headline names the studio</li>
              <li className="flex gap-2"><span className="text-met font-medium w-16">Met</span> Waitlist signup form</li>
              <li className="flex gap-2"><span className="text-unmet font-medium w-16">Not met</span> Saturday class start time</li>
              <li className="flex gap-2"><span className="text-unmet font-medium w-16">Not met</span> Studio address</li>
            </ul>
            <div className="mt-5 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              Evidence from the delivered page: &ldquo;Saturday wheel-throwing (schedule coming soon)&rdquo;
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 pb-20 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((s) => (
            <div key={s.title} className="rounded-xl border bg-card p-5">
              <s.icon className="size-5 text-primary" />
              <h3 className="mt-3 font-medium">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">MIT licensed. Built for the PayPal AI Hackathon.</footer>
    </div>
  );
}
