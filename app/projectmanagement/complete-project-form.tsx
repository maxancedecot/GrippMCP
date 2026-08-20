"use client";

import { useFormStatus } from "react-dom";
import { completeProjectAction } from "./actions.js";

export function CompleteProjectForm({
  projectId,
  projectName,
  query
}: {
  projectId: number;
  projectName: string;
  query: string;
}) {
  return (
    <form
      className="project-completion-form"
      action={completeProjectAction}
      onSubmit={(event) => {
        if (!window.confirm(`Opdracht '${projectName}' als afgerond markeren?`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="query" value={query} />
      <CompleteProjectButton projectName={projectName} />
    </form>
  );
}

function CompleteProjectButton({ projectName }: { projectName: string }) {
  const { pending } = useFormStatus();

  return (
    <button className="project-complete-button" type="submit" disabled={pending} title={`Rond ${projectName} af`}>
      {pending ? "Afronden..." : "Afronden"}
    </button>
  );
}
