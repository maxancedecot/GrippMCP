import { z } from "zod";
import { GhlClient } from "./client.js";
import { listGhlInstallations } from "./tokenStore.js";
import { GrippMcpError } from "../errors.js";

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
    contactId: z.string().min(1).nullish(),
    contact: z.object({ id: z.string().min(1).nullish() }).nullish()
  })),
  meta: z.object({
    nextPage: z.union([
      z.number().int(), z.boolean(), z.string().regex(/^-?\d+$/).transform(Number),
      z.literal("").transform(() => null), z.literal("false").transform(() => false), z.literal("true").transform(() => true)
    ]).nullish()
  }).passthrough().optional()
});

const contactResponse = z.object({
  contact: z.object({
    id: z.string().min(1),
    locationId: z.string().nullish(),
    tags: z.array(z.string()),
    dateAdded: z.union([z.string(), z.number()]).nullish()
  })
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
export type GhlPipelineConversionCount = {
  pipelineId: string;
  pipelineName: string;
  leads: number | null;
  appointments: number | null;
  leadContactIds: string[];
  appointmentContactIds: string[];
};

export async function listGhlPipelines(config: GhlAppointmentConfig, call?: GhlReadCall) {
  const installId = config.installId ?? await installIdForLocation(config.locationId);
  const read: GhlReadCall = call ?? (async (input) => new GhlClient(input.installId).call({
    method: "GET", path: input.path, query: input.query, apiVersion: input.apiVersion, readOnly: true
  }));
  return pipelineResponse.parse(await read({
    installId, path: "/opportunities/pipelines", query: { locationId: config.locationId }, apiVersion: "v3"
  })).pipelines;
}

export function classifyGhlContactTags(tags: readonly string[]): "lead" | "appointment" | null {
  const words = new Set(tags.flatMap((tag) => tag.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)));
  if (!words.has("ledoux")) return null;
  if (words.has("afspraak")) return "appointment";
  return words.has("brochure") || words.has("contact") ? "lead" : null;
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

  // Fetch each contact once per location, even when it occurs in multiple linked pipelines.
  const contacts = new Map<string, z.infer<typeof contactResponse>["contact"]>();
  const counts: GhlPipelineConversionCount[] = [];
  for (const pipeline of pipelines) {
    const opportunities = new Map<string, z.infer<typeof opportunityResponse>["opportunities"][number]>();
    let page = 1;
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
        if (opportunity.contactId && opportunity.contact?.id && opportunity.contactId !== opportunity.contact.id) {
          throw new Error("Unexpected GoHighLevel contact");
        }
        opportunities.set(opportunity.id, opportunity);
      }
      const nextPage = result.meta?.nextPage;
      if (nextPage === null || nextPage === false || (typeof nextPage === "number" && nextPage <= 0)
        || (nextPage === undefined && result.opportunities.length < 100)) break;
      if (request === 99) throw new Error("GoHighLevel opportunity pagination limit reached");
      if (typeof nextPage === "number" && nextPage <= page) throw new Error("Invalid GoHighLevel opportunity pagination");
      page = typeof nextPage === "number" ? nextPage : page + 1;
    }
    const contactIds = [...new Set([...opportunities.values()].map((opportunity) => opportunity.contactId ?? opportunity.contact?.id).filter((id): id is string => Boolean(id)))];
    const missingContacts = contactIds.filter((id) => !contacts.has(id));
    for (let offset = 0; offset < missingContacts.length; offset += 4) {
      const batch = await Promise.all(missingContacts.slice(offset, offset + 4).map(async (id) => {
        const contact = contactResponse.parse(await read({
          installId, path: `/contacts/${encodeURIComponent(id)}`, apiVersion: "v3"
        })).contact;
        if (contact.id !== id || (contact.locationId && contact.locationId !== config.locationId)) {
          throw new Error("Unexpected GoHighLevel contact");
        }
        return contact;
      }));
      for (const contact of batch) contacts.set(contact.id, contact);
    }
    const leads = new Set<string>(), appointments = new Set<string>();
    let completeLeads = [...opportunities.values()].every((opportunity) => opportunity.contactId || opportunity.contact?.id);
    let completeAppointments = completeLeads;
    for (const id of contactIds) {
      const contact = contacts.get(id)!;
      const classification = classifyGhlContactTags(contact.tags);
      if (!classification) continue;
      const created = dateKey(contact.dateAdded);
      if (!created) {
        if (classification === "lead") completeLeads = false;
        else completeAppointments = false;
      } else if (created >= period.start && created <= period.end) {
        (classification === "lead" ? leads : appointments).add(id);
      }
    }
    counts.push({ pipelineId: pipeline.id, pipelineName: pipeline.name,
      leads: completeLeads ? leads.size : null, appointments: completeAppointments ? appointments.size : null,
      leadContactIds: [...leads], appointmentContactIds: [...appointments] });
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
