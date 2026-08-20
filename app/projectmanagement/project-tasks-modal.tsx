"use client";

import { useRef, useState } from "react";
import { getProjectTasksAction, type ProjectTask } from "./actions.js";

type TaskLoadState = "idle" | "loading" | "ready" | "error";

const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

export function ProjectTasksModal({ projectId, projectName }: { projectId: number; projectName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [state, setState] = useState<TaskLoadState>("idle");
  const [error, setError] = useState("");

  const openTasks = async () => {
    dialogRef.current?.showModal();
    setState("loading");
    setError("");

    try {
      const result = await getProjectTasksAction(projectId);
      setTasks(result.tasks);
      setError(result.error ?? "");
      setState(result.error ? "error" : "ready");
    } catch {
      setTasks([]);
      setError("Taken konden niet worden geladen.");
      setState("error");
    }
  };

  return (
    <>
      <button className="project-task-trigger row-title" type="button" onClick={openTasks} title={`Bekijk taken van ${projectName}`}>
        {projectName}
      </button>

      <dialog
        className="project-tasks-dialog"
        ref={dialogRef}
        aria-labelledby={`project-tasks-title-${projectId}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            event.currentTarget.close();
          }
        }}
      >
        <header className="project-tasks-dialog__header">
          <div>
            <p className="eyebrow">Taken</p>
            <h2 id={`project-tasks-title-${projectId}`}>{projectName}</h2>
          </div>
          <button className="project-tasks-dialog__close" type="button" onClick={() => dialogRef.current?.close()} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </header>

        <div className="project-tasks-dialog__body" aria-live="polite">
          {state === "loading" || state === "idle" ? <p className="empty-state">Taken laden...</p> : null}
          {state === "error" ? <p className="empty-state">{error}</p> : null}
          {state === "ready" && tasks.length === 0 ? <p className="empty-state">Geen taken gevonden voor deze opdracht.</p> : null}
          {state === "ready" && tasks.length > 0 ? (
            <ul className="project-task-list">
              {tasks.map((task) => (
                <li className="project-task-list__item" key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{taskDetails(task)}</span>
                  </div>
                  <span className={`project-task-status project-task-status--${task.completed ? "completed" : "open"}`}>
                    {task.completed ? "Afgerond" : "Open"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

function taskDetails(task: ProjectTask) {
  const details = [
    task.startDate ? `Start ${formatDate(task.startDate)}` : "",
    task.deadlineDate ? `Deadline ${formatDate(task.deadlineDate)}` : ""
  ].filter(Boolean);

  return details.join(" · ") || "Geen planning ingevuld";
}

function formatDate(date: string) {
  return dateFormatter.format(new Date(`${date}T00:00:00`));
}
