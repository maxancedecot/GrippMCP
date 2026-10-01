import { z } from "zod";
import { GhlClient } from "./client.js";
import { listGhlInstallations } from "./tokenStore.js";

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
    pipelineId: z.string().optional(),
    pipelineStageId: z.string().optional(),
    createdAt: z.union([z.string(), z.number()]).optional(),
    lastStageChangeAt: z.union([z.string(), z.number()]).optional()
  })),
  meta: z.object({ nextPage: z.number().int().positive().nullable().optional() }).passthrough().optional()
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
  const available = pipelineResponse.parse(await read({
    installId, path: "/opportunities/pipelines", query: { locationId: config.locationId }, apiVersion: "v3"
  })).pipelines;
  if (config.pipelineIds?.some((pipelineId) => !available.some((pipeline) => pipeline.id === pipelineId))) throw new Error("Unknown GoHighLevel pipeline");
  const pipelines = available.filter((pipeline) => !config.pipelineIds || config.pipelineIds.includes(pipeline.id));

  const counts: GhlPipelineConversionCount[] = [];
  for (const pipeline of pipelines) {
    const stages = new Set(pipeline.stages.filter((stage) => isAppointmentStage(stage.name)).map((stage) => stage.id));
    const leads = new Set<string>(), appointments = new Set<string>();
    let completeLeads = true, completeAppointments = stages.size > 0, page = 1;
    for (let request = 0; request < 100; request++) {
      const result = opportunityResponse.parse(await read({
        installId, path: "/opportunities/search",
        query: { locationId: config.locationId, pipelineId: pipeline.id, status: "all", limit: 100, page }, apiVersion: "v3"
      }));
      for (const opportunity of result.opportunities) {
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
      if (nextPage === null || (nextPage === undefined && result.opportunities.length < 100)) break;
      if (request === 99) throw new Error("GoHighLevel opportunity pagination limit reached");
      if (nextPage !== undefined && nextPage !== null && nextPage <= page) throw new Error("Invalid GoHighLevel opportunity pagination");
      page = nextPage ?? page + 1;
    }
    counts.push({ pipelineId: pipeline.id, pipelineName: pipeline.name,
      leads: completeLeads ? leads.size : null, appointments: completeAppointments ? appointments.size : null });
  }
  return counts;
}

function dateKey(value: string | number | undefined) {
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
