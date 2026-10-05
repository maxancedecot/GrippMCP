import { z } from "zod";
import { GhlClient } from "./client.js";
import { listGhlInstallations } from "./tokenStore.js";
import { GrippMcpError } from "../errors.js";

const appointmentWords = [
  "afspraak", "appointment", "booked", "booking", "meeting", "consult", "consultation", "bezichtiging", "viewing",
  "ingepland", "scheduled", "intake", "demo", "rondleiding", "gesprek"
];
const cancelledWords = ["cancel", "annul", "no show", "no-show", "niet gekomen"];

const pipelineResponse = z.object({
  pipelines: z.array(z.object({
    id: z.string().min(1),
    name: z.string().default(""),
    stages: z.array(z.object({ id: z.string().min(1), name: z.string().default("") })).default([])
  }))
});
const opportunityResponse = z.object({
  opportunities: z.array(z.object({
    id: z.string().min(1),
    pipelineId: z.string().nullish(),
    pipelineStageId: z.string().nullish(),
    createdAt: z.union([z.string(), z.number()]).nullish(),
    lastStageChangeAt: z.union([z.string(), z.number()]).nullish()
  })),
  meta: z.object({
    nextPage: z.union([z.number().int().nonnegative(), z.boolean(), z.string().regex(/^\d+$/).transform(Number)]).nullish(),
  }).passthrough().optional()
});

export type GhlReadCall = (input: {
  installId: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  apiVersion: string;
}) => Promise<unknown>;

export type GhlAppointmentConfig = {
  locationId: string;
  installId?: string;
  pipelineIds?: string[];
};
export type GhlPipelineAppointmentCount = { pipelineId: string; pipelineName: string; count: number };
export type GhlPipelineConversionCount = { pipelineId: string; pipelineName: string; leads: number | null; appointments: number | null };

export async function listGhlPipelines(config: GhlAppointmentConfig, call?: GhlReadCall) {
  const installId = config.installId ?? await installIdForLocation(config.locationId);
  const read: GhlReadCall = call ?? (async (input) => new GhlClient(input.installId).call({
    method: "GET", path: input.path, query: input.query, apiVersion: input.apiVersion, readOnly: true
  }));
  return pipelineResponse.parse(await read({
    installId, path: "/opportunities/pipelines", query: { locationId: config.locationId }, apiVersion: "v3"
  })).pipelines;
}

export function isAppointmentStage(name: string) {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return !cancelledWords.some((word) => normalized.includes(word))
    && appointmentWords.some((word) => normalized.includes(word));
}

export async function countGhlAppointments(config: GhlAppointmentConfig, period: { start: string; end: string }, call?: GhlReadCall) {
  const counts = await ghlAppointmentsByPipeline(config, period, call);
  return counts.reduce((sum, pipeline) => sum + pipeline.count, 0);
}

export async function ghlAppointmentsByPipeline(config: GhlAppointmentConfig, period: { start: string; end: string }, call?: GhlReadCall) {
  return (await ghlConversionsByPipeline(config, period, call)).flatMap((pipeline) => pipeline.appointments === null ? [] : [{
    pipelineId: pipeline.pipelineId, pipelineName: pipeline.pipelineName, count: pipeline.appointments
  }]);
}

export async function ghlConversionsByPipeline(config: GhlAppointmentConfig, period: { start: string; end: string }, call?: GhlReadCall) {
  const installId = config.installId ?? await installIdForLocation(config.locationId);
  const read: GhlReadCall = call ?? (async (input) => new GhlClient(input.installId).call({
    method: "GET", path: input.path, query: input.query, apiVersion: input.apiVersion, readOnly: true
  }));
  const available = await listGhlPipelines({ ...config, installId }, read);
  if (config.pipelineIds?.some((pipelineId) => !available.some((pipeline) => pipeline.id === pipelineId))) throw new Error("Unknown GoHighLevel pipeline");
  const pipelines = available.filter((pipeline) => !config.pipelineIds || config.pipelineIds.includes(pipeline.id));

  const counts: GhlPipelineConversionCount[] = [];
  for (const pipeline of pipelines) {
    const stages = new Set(pipeline.stages.filter((stage) => isAppointmentStage(stage.name)).map((stage) => stage.id));
    const leads = new Set<string>(), appointments = new Set<string>();
    let completeLeads = true, completeAppointments = stages.size > 0, page = 1;
    const seenOpportunities = new Set<string>();
    for (let request = 0; request < 100; request++) {
      const result = opportunityResponse.parse(await read({
        installId, path: "/opportunities/search",
        query: { locationId: config.locationId, pipelineId: pipeline.id, status: "all", limit: 100, page }, apiVersion: "v3"
      }).catch((error: unknown) => {
        if (error instanceof GrippMcpError && error.code === "ghl_upstream_error") {
          const details = z.object({ status: z.number() }).passthrough().safeParse(error.details);
          if (details.success) throw new GrippMcpError(error.code, error.message, { ...details.data, crmPage: page });
        }
        throw error;
      }));
      if (request > 0 && result.opportunities.length > 0 && result.opportunities.every((opportunity) => seenOpportunities.has(opportunity.id))) {
        throw new Error("Repeated GoHighLevel opportunity page");
      }
      for (const opportunity of result.opportunities) {
        seenOpportunities.add(opportunity.id);
        if (opportunity.pipelineId && opportunity.pipelineId !== pipeline.id) throw new Error("Unexpected GoHighLevel pipeline");
        const created = dateKey(opportunity.createdAt);
        if (!created) completeLeads = false;
        else if (created >= period.start && created <= period.end) leads.add(opportunity.id);
        if (!opportunity.pipelineStageId) { completeAppointments = false; continue; }
        if (!stages.has(opportunity.pipelineStageId)) continue;
        const changed = dateKey(opportunity.lastStageChangeAt);
        if (!changed) completeAppointments = false;
        else if (changed >= period.start && changed <= period.end) appointments.add(opportunity.id);
      }
      const nextPage = result.meta?.nextPage;
      if (nextPage === null || nextPage === false || nextPage === 0 || (nextPage === undefined && result.opportunities.length < 100)) break;
      if (request === 99) throw new Error("GoHighLevel opportunity pagination limit reached");
      if (typeof nextPage === "number" && nextPage <= page) throw new Error("Invalid GoHighLevel opportunity pagination");
      page = typeof nextPage === "number" ? nextPage : page + 1;
    }
    counts.push({ pipelineId: pipeline.id, pipelineName: pipeline.name,
      leads: completeLeads ? leads.size : null, appointments: completeAppointments ? appointments.size : null });
  }
  return counts;
}

function dateKey(value: string | number | null | undefined) {
  const timestamp = typeof value === "number" ? value : Date.parse(value ?? "");
  return Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime()) ? brusselsDateKey(timestamp) : "";
}

function brusselsDateKey(timestamp: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(timestamp));
}

async function installIdForLocation(locationId: string) {
  const matches = (await listGhlInstallations()).filter((installation) => installation.locationId === locationId);
  if (matches.length !== 1) throw new Error(`No unique GoHighLevel installation for location '${locationId}'.`);
  return matches[0]!.installId;
}
