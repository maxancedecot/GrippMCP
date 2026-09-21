import type { CampaignProjectRow } from "./campaignProjects.js";
import { projectPageKey, type ManagedProjectPage } from "./projectPageManagement.js";

type AccountManagerAssignments = Record<string, ManagedProjectPage>;

export function filterCampaignProjectsByManager(
  projects: CampaignProjectRow[],
  assignments: AccountManagerAssignments,
  requestedManager: string | undefined
) {
  const assignmentFor = (project: CampaignProjectRow) => assignments[projectPageKey({ siteId: project.siteId, path: project.sourcePath })];
  const managers = [...new Map(projects.flatMap((project) => {
    const assignment = assignmentFor(project);
    return assignment?.accountManagerId !== null && assignment?.accountManagerName
      ? [[String(assignment.accountManagerId), assignment.accountManagerName] as const]
      : [];
  })).entries()].sort((left, right) => left[1].localeCompare(right[1], "nl-BE"));
  const selectedManager = requestedManager === "unassigned" || managers.some(([id]) => id === requestedManager)
    ? requestedManager ?? ""
    : "";
  const filteredProjects = selectedManager
    ? projects.filter((project) => {
        const assignment = assignmentFor(project);
        return selectedManager === "unassigned"
          ? !assignment || assignment.accountManagerId === null
          : String(assignment?.accountManagerId) === selectedManager;
      })
    : projects;

  return { managers, selectedManager, projects: filteredProjects, totalProjects: projects.length };
}

export function summarizeFilteredCampaignProjects(projects: CampaignProjectRow[]) {
  const measured = projects.filter((project) => project.visitors !== null);
  const visitors = measured.reduce((sum, project) => sum + (project.visitors ?? 0), 0);
  const leads = projects.filter((project) => project.leads !== null).reduce((sum, project) => sum + (project.leads ?? 0), 0);
  const appointments = projects.filter((project) => project.appointments !== null)
    .reduce((sum, project) => sum + (project.appointments ?? 0), 0);
  const conversions = projects.reduce((sum, project) => sum + (project.leads ?? 0) + (project.appointments ?? 0), 0);
  return {
    visitors,
    leads,
    appointments,
    conversionRate: visitors > 0 ? conversions / visitors * 100 : null,
    measuredProjects: measured.length,
    leadProjects: projects.filter((project) => project.leads !== null).length,
    appointmentProjects: projects.filter((project) => project.appointments !== null).length
  };
}
