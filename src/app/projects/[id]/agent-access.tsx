"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAgentTokenAction, revokeAgentTokenAction } from "@/app/actions";

type TokenRow = { id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

/** Lets the operator give a coding agent access to this project's freelancer side over MCP. */
export function AgentAccess({ projectId, endpoint, tokens }: { projectId: string; endpoint: string; tokens: TokenRow[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("Coding agent");
  const [fresh, setFresh] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const active = tokens.filter((t) => !t.revokedAt);
  const config = fresh ? `claude mcp add --transport http signoff ${endpoint} --header "Authorization: Bearer ${fresh}"` : "";
  return (
    <details className="rounded-xl border bg-card p-4 sm:p-5 group" open={active.length > 0 || undefined}>
      <summary className="cursor-pointer list-none flex items-center gap-2 font-medium">
        <Bot className="size-5 text-primary" /> Agent access <span className="text-sm font-normal text-muted-foreground">Let your coding agent submit deliveries and read reports over MCP</span>
      </summary>
      <div className="mt-4 space-y-4 text-sm">
        <p className="text-muted-foreground">
          A token reaches this project only. The agent can list milestones, submit a delivery and read the evidence report. It has no payment tools: it cannot fund, release, decline or touch disputes.
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await createAgentTokenAction(projectId, label).catch(() => ({ ok: false as const, error: "The request failed" }));
              if (!r.ok) return void toast.error(r.error);
              setFresh(r.data!.token);
              router.refresh();
            });
          }}
        >
          <Input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Token name" className="max-w-56" maxLength={60} />
          <Button type="submit" variant="outline" disabled={pending}><KeyRound /> Create token</Button>
        </form>
        {fresh && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-2">
            <div className="font-medium">Copy this token now. It will not be shown again.</div>
            <div className="flex gap-2">
              <Input readOnly value={fresh} className="font-mono text-xs min-w-0" aria-label="New agent token" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" size="icon" aria-label="Copy token" onClick={() => { navigator.clipboard.writeText(fresh); toast.success("Token copied"); }}><Copy /></Button>
            </div>
            <div className="text-xs text-muted-foreground">Add it to Claude Code, for example:</div>
            <pre className="whitespace-pre-wrap break-all rounded bg-background border p-2 font-mono text-xs">{config}</pre>
          </div>
        )}
        <div className="text-xs text-muted-foreground">Endpoint: <span className="font-mono break-all">{endpoint}</span></div>
        {tokens.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <span className="font-medium">{t.label}</span>
                <span className="text-xs text-muted-foreground">Created {t.createdAt}{t.lastUsedAt ? `, last used ${t.lastUsedAt}` : ", not used yet"}</span>
                {t.revokedAt ? (
                  <span className="ml-auto text-xs text-muted-foreground">Revoked</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-destructive"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await revokeAgentTokenAction(projectId, t.id).catch(() => ({ ok: false as const, error: "The request failed" }));
                        if (!r.ok) return void toast.error(r.error);
                        toast.success("Token revoked. The agent can no longer reach this project.");
                        router.refresh();
                      })
                    }
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
