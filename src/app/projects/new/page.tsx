import { OperatorShell } from "@/components/app/operator-shell";
import { requireWorkspace } from "@/lib/web/auth";
import { SAMPLE_SCOPE } from "@/lib/sample";
import { resolveModel } from "@/lib/ai/model";
import { env } from "@/lib/env";
import { NewProjectForm } from "./new-project-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New project" };

export default async function NewProject() {
  await requireWorkspace();
  return (
    <OperatorShell>
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      <p className="text-muted-foreground text-sm mt-1">Paste the scope you agreed with the client. The AI drafts milestones and acceptance criteria, each tied to a sentence in the scope. You edit, then send the client a link.</p>
      {env().DEMO_MODE && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          This public demo uses the free tier of Google Gemini, which may use what you paste to improve Google&apos;s products. Use the sample scope or made-up text, not a real client&apos;s documents.
        </p>
      )}
      <NewProjectForm sampleScope={SAMPLE_SCOPE} modelLabel={resolveModel().label} />
    </OperatorShell>
  );
}
