import { OperatorShell } from "@/components/app/operator-shell";
import { requireWorkspace } from "@/lib/web/auth";
import { SAMPLE_SCOPE } from "@/lib/sample";
import { resolveModel } from "@/lib/ai/model";
import { NewProjectForm } from "./new-project-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New project" };

export default async function NewProject() {
  await requireWorkspace();
  return (
    <OperatorShell>
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      <p className="text-muted-foreground text-sm mt-1">Paste the scope you agreed with the client. The AI drafts milestones and acceptance criteria, each tied to a sentence in the scope. You edit, then send the client a link.</p>
      <NewProjectForm sampleScope={SAMPLE_SCOPE} modelLabel={resolveModel().label} />
    </OperatorShell>
  );
}
