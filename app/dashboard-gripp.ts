import { GrippClient } from "../src/grippClient.js";

export const DASHBOARD_GRIPP_API_TOKEN_ENV = "GRIPP_DASHBOARD_API_TOKEN";

export function dashboardGrippApiToken() {
  return process.env[DASHBOARD_GRIPP_API_TOKEN_ENV]?.trim() ?? "";
}

export function hasDashboardGrippApiToken() {
  return dashboardGrippApiToken().length > 0;
}

export function createDashboardGrippClient() {
  const token = dashboardGrippApiToken();
  if (!token) {
    throw new Error(`${DASHBOARD_GRIPP_API_TOKEN_ENV} ontbreekt.`);
  }

  return new GrippClient({ token });
}
