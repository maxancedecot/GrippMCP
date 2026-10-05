import { z } from "zod";
import { GrippMcpError } from "./errors.js";

export type CrmPipelineLoadStage = "installation_check" | "location_connection" | "pipelines";

export class CrmPipelineLoadError extends Error {
  constructor(public readonly stage: CrmPipelineLoadStage, cause: unknown) {
    super("CRM pipeline loading failed", { cause });
    this.name = "CrmPipelineLoadError";
  }
}

/** Only return known stages/statuses/schema fields, never provider error text. */
export function crmPipelineLoadErrorMessage(error: unknown): string {
  const stage = error instanceof CrmPipelineLoadError ? error.stage : "pipelines";
  const cause = error instanceof CrmPipelineLoadError ? error.cause : error;
  if (cause instanceof GrippMcpError && cause.code === "crm_app_not_installed") {
    return "De app is niet geïnstalleerd of niet toegankelijk voor de CRM-verbinding in dit subaccount. Controleer de app-installatie en subaccounttoegang in GoHighLevel.";
  }
  if (cause instanceof Error && /^No GoHighLevel OAuth installation found|^GoHighLevel token refresh failed/.test(cause.message)) {
    return "De CRM-verbinding van dit subaccount moet opnieuw worden verbonden. Verbind het subaccount opnieuw via GoHighLevel.";
  }
  if (cause instanceof GrippMcpError && cause.code === "crm_connection_changed") {
    return "De subaccountselectie is verouderd. Vernieuw Data management en kies het subaccount opnieuw.";
  }
  const intro = stage === "installation_check" ? "De app-installatie voor dit subaccount kon niet worden gecontroleerd"
    : stage === "location_connection" ? "De CRM-verbinding voor dit subaccount kon niet worden geopend"
    : "De CRM-pipelines konden niet worden geladen";
  if (cause instanceof GrippMcpError && cause.code === "ghl_upstream_error") {
    const status = z.object({ status: z.number().int().min(400).max(599) }).safeParse(cause.details);
    if (status.success) {
      const next = status.data.status === 401 ? "Verbind de CRM-verbinding opnieuw."
        : status.data.status === 403 ? "Controleer de toegangsrechten van de bestaande CRM-verbinding voor dit subaccount."
        : status.data.status === 429 ? "GoHighLevel beperkt tijdelijk de aanvragen. Probeer het even later opnieuw."
        : "Probeer opnieuw; blijft dit gebeuren, controleer de CRM-verbinding.";
      return `${intro} (HTTP ${status.data.status}). ${next}`;
    }
  }
  if (cause instanceof z.ZodError) {
    const field = cause.issues[0]?.path.filter((part) => typeof part === "string" && /^[a-zA-Z_]+$/.test(part)).join(".");
    return `${intro}: het CRM-antwoord heeft een onverwachte structuur${field ? ` (${field})` : ""}.`;
  }
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
    return `${intro}: GoHighLevel reageerde niet op tijd. Probeer opnieuw.`;
  }
  return `${intro}. Vernieuw de gegevens en probeer opnieuw.`;
}
