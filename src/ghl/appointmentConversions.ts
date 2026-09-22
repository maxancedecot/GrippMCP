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
  })).default([])
});
const opportunityResponse = z.object({
  opportunities: z.array(z.object({
    id: z.string().min(1),
    pipelineId: z.string().optional(),
    pipelineStageId: z.string().optional(),
    lastStageChangeAt: z.union([z.string(), z.number()]).optional()
  })).default([]),
  meta: z.object({ nextPage: z.number().nullable().optional() }).passthrough().optional()
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
  const installId = config.installId ?? await installIdForLocation(config.locationId);
  const read: GhlReadCall = call ?? (async (input) => new GhlClient(input.installId).call({
    method: "GET", path: input.path, query: input.query, apiVersion: input.apiVersion, readOnly: true
  }));
  const pipelines = pipelineResponse.parse(await read({
    installId, path: "/opportunities/pipelines", query: { locationId: config.locationId }, apiVersion: "v3"
  })).pipelines.filter((pipeline) => !config.pipelineIds || config.pipelineIds.includes(pipeline.id));
  const stages = new Map(pipelines.flatMap((pipeline) => pipeline.stages
    .filter((stage) => isAppointmentStage(stage.name)).map((stage) => [stage.id, pipeline.id] as const)));
  if (stages.size === 0) return [];

  const counts: GhlPipelineAppointmentCount[] = [];
  for (const pipeline of pipelines.filter((item) => item.stages.some((stage) => stages.has(stage.id)))) {
    const appointments = new Set<string>();
    for (let page = 1; page <= 100; page++) {
      const result = opportunityResponse.parse(await read({
        installId, path: "/opportunities/search",
        query: { locationId: config.locationId, pipelineId: pipeline.id, status: "all", limit: 100, page }, apiVersion: "v3"
      }));
      for (const opportunity of result.opportunities) {
        if (!opportunity.pipelineStageId || !stages.has(opportunity.pipelineStageId)) continue;
        const changedAt = typeof opportunity.lastStageChangeAt === "number"
          ? opportunity.lastStageChangeAt : Date.parse(opportunity.lastStageChangeAt ?? "");
        const date = Number.isFinite(changedAt) ? brusselsDateKey(changedAt) : "";
        if (date >= period.start && date <= period.end) appointments.add(opportunity.id);
      }
      if (result.opportunities.length < 100 || result.meta?.nextPage == null) break;
      if (page === 100) throw new Error("GoHighLevel opportunity pagination limit reached");
    }
    counts.push({ pipelineId: pipeline.id, pipelineName: pipeline.name, count: appointments.size });
  }
  return counts;
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
