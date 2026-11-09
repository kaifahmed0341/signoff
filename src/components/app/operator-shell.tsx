import Link from "next/link";
import { Brand } from "./brand";
import { railMode } from "@/lib/env";
import { resolveModel } from "@/lib/ai/model";
import { Badge } from "@/components/ui/badge";
import { logout } from "@/app/actions";

export function OperatorShell({ children }: { children: React.ReactNode }) {
  const rail = railMode();
  const model = resolveModel().label;
  return (
    <div className="min-h-screen flex flex-col">
      <header className="no-print border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
          <Brand href="/dashboard" />
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:text-foreground">Projects</Link>
            <Link href="/projects/new" className="hover:text-foreground">New project</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <Badge variant="outline" title="Payment rail">{rail === "fake" ? "Test rail (no Braintree keys)" : `Braintree ${rail}`}</Badge>
            <Badge variant="outline" title="Checker model">{model === "scripted" ? "Scripted checker (no AI key)" : model}</Badge>
            <form action={logout}>
              <button className="text-muted-foreground hover:text-foreground px-2">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
