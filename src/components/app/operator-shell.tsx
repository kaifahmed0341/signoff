import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Brand } from "./brand";
import { railMode } from "@/lib/env";
import { resolveModel } from "@/lib/ai/model";
import { Badge } from "@/components/ui/badge";
import { logout } from "@/app/actions";
import { currentWorkspace } from "@/lib/web/auth";

export async function OperatorShell({ children }: { children: React.ReactNode }) {
  const rail = railMode();
  const model = resolveModel().label;
  const ws = await currentWorkspace();
  const demo = ws?.kind === "demo";
  return (
    <div className="min-h-screen flex flex-col">
      {demo && (
        <div className="no-print bg-amber-50 border-b border-amber-200 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-900">
          <div className="mx-auto max-w-6xl px-4 py-2 text-xs sm:text-sm flex items-center gap-2">
            <FlaskConical className="size-4 shrink-0" />
            <span>
              <strong>Demo workspace.</strong> Sandbox money only, nothing is really charged. Your projects are private to this browser and are deleted after 30 days without a visit.
            </span>
          </div>
        </div>
      )}
      <header className="no-print border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-4 sm:gap-6">
          <Brand href="/dashboard" />
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:text-foreground">Projects</Link>
            <Link href="/projects/new" className="hover:text-foreground">New project</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <Badge variant="outline" className="hidden md:inline-flex" title="Payment rail">
              {rail === "fake" ? "Test rail (no Braintree keys)" : `Braintree ${rail}`}
            </Badge>
            <Badge variant="outline" className="hidden md:inline-flex" title="Checker model">
              {model === "scripted" ? "Scripted checker (no AI key)" : model}
            </Badge>
            {!demo && (
              <form action={logout}>
                <button className="text-muted-foreground hover:text-foreground px-2">Sign out</button>
              </form>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
