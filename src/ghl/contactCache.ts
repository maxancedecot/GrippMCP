import { createHash } from "node:crypto";
import { z } from "zod";
import { readJsonCache, writeJsonCache } from "../jsonCache.js";
import { GrippMcpError } from "../errors.js";
import type { GhlReadCall } from "./appointmentConversions.js";

const FRESH_MS = 5 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const SEARCH_LAG_MS = 60_000;
const contactSchema = z.object({
  id: z.string().min(1), locationId: z.string().nullish(),
  tags: z.array(z.string()).nullish().transform((tags) => tags ?? []),
  dateAdded: z.union([z.string(), z.number()]).nullish(),
  dateUpdated: z.string().nullish()
});
export type CachedGhlContact = z.infer<typeof contactSchema>;
const indexSchema = z.object({ version: z.literal(1), checkedAt: z.number().finite(), fullCheckedAt: z.number().finite(), contacts: z.record(contactSchema) });
export type ContactCacheStore = { read<T>(key: string): Promise<T | null>; write(key: string, value: unknown): Promise<void> };
export type ContactCacheOptions = { force?: boolean; now?: Date; store?: ContactCacheStore };
const defaultStore: ContactCacheStore = { read: readJsonCache, write: writeJsonCache };
const queues = new Map<string, Promise<void>>();

export async function loadCachedGhlContacts(ids: string[], scope: { installId: string; locationId: string }, read: GhlReadCall,
  { force = false, now = new Date(), store = defaultStore }: ContactCacheOptions = {}): Promise<Map<string, CachedGhlContact>> {
  if (!ids.length) return new Map();
  const key = `ghl-contact-cache:v1:${createHash("sha256").update(JSON.stringify([scope.installId, scope.locationId])).digest("hex")}`;
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  queues.set(key, pending);
  await previous;
  try {
    const stored = indexSchema.safeParse(await store.read(key).catch(() => null));
    const age = stored.success ? now.getTime() - stored.data.checkedAt : Infinity;
    const cached = stored.success && age >= 0 && age < MAX_AGE_MS ? stored.data : null;
    const contacts = new Map<string, CachedGhlContact>();
    for (const [id, contact] of Object.entries(cached?.contacts ?? {})) {
      if (contact.id === id && (!contact.locationId || contact.locationId === scope.locationId)) contacts.set(id, contact);
    }
    const required = [...new Set(ids)];
    const stale = cached !== null && age >= FRESH_MS;
    const changed = !cached || stale || force || required.some((id) => !contacts.has(id));
    let checkedAt = cached?.checkedAt ?? now.getTime();
    let fullCheckedAt = cached?.fullCheckedAt ?? now.getTime();
    const fullRefreshDue = cached !== null && now.getTime() - fullCheckedAt >= MAX_AGE_MS;
    const validate = (raw: unknown): CachedGhlContact => {
      const contact = contactSchema.parse(raw);
      if (contact.locationId && contact.locationId !== scope.locationId) throw new Error("Unexpected GoHighLevel contact");
      return contact;
    };
    const direct = async (id: string) => {
      const result = z.object({ contact: z.unknown() }).parse(await read({ installId: scope.installId, path: `/contacts/${encodeURIComponent(id)}`, apiVersion: "2021-07-28" }));
      const contact = validate(result.contact);
      if (contact.id !== id) throw new Error("Unexpected GoHighLevel contact");
      contacts.set(id, contact);
    };
    const search = async (body: Record<string, unknown>) => z.object({ contacts: z.array(z.unknown()), total: z.number().int().nonnegative() }).parse(await read({
      installId: scope.installId, path: "/contacts/search", apiVersion: "2021-07-28", method: "POST", body: body as NonNullable<Parameters<GhlReadCall>[0]["body"]>
    }));
    const unsupported = (error: unknown) => {
      if (!(error instanceof GrippMcpError) || error.code !== "ghl_upstream_error") return false;
      const status = z.object({ status: z.number() }).passthrough().safeParse(error.details);
      return status.success && [400, 404, 405].includes(status.data.status);
    };
    let canSearch = true;
    async function fetchIds(missing: string[]) {
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100);
        if (canSearch) {
          try {
            const result = await search({ locationId: scope.locationId, page: 1, pageLimit: 100,
              filters: [{ group: "OR", filters: batch.map((id) => ({ field: "id", operator: "eq", value: id })) }] });
            if (result.total > batch.length || result.contacts.length > batch.length) throw new Error("Unexpected GoHighLevel contact search");
            const seen = new Set<string>();
            for (const raw of result.contacts) {
              const contact = validate(raw);
              if (!batch.includes(contact.id) || seen.has(contact.id)) throw new Error("Unexpected GoHighLevel contact");
              seen.add(contact.id); contacts.set(contact.id, contact);
            }
            // Search is eventually consistent. Missing/deleted contacts must be checked directly.
            const missingIds = batch.filter((id) => !seen.has(id));
            for (let start = 0; start < missingIds.length; start += 4) await Promise.all(missingIds.slice(start, start + 4).map(direct));
            continue;
          } catch (error) { if (!unsupported(error)) throw error; canSearch = false; }
        }
        for (let start = 0; start < batch.length; start += 4) await Promise.all(batch.slice(start, start + 4).map(direct));
      }
    }
    if (stale && !force && !fullRefreshDue && [...contacts.values()].every((contact) => Number.isFinite(Date.parse(contact.dateUpdated ?? "")))) {
      // Sorted delta reads stop once we reach the previous watermark. The overlap
      // absorbs the documented search-index delay; only changed tracked IDs are merged.
      const cutoff = cached!.checkedAt - SEARCH_LAG_MS;
      let previousUpdated = Infinity;
      const seen = new Set<string>();
      let complete = false;
      try {
        for (let page = 1; page <= 20; page++) {
          const result = await search({ locationId: scope.locationId, page, pageLimit: 500, sort: [{ field: "dateUpdated", direction: "desc" }] });
          if (result.contacts.length > 500) throw new Error("Unexpected GoHighLevel contact search");
          for (const raw of result.contacts) {
            const metadata = z.object({ id: z.string().min(1), dateUpdated: z.string(), locationId: z.string().nullish() }).parse(raw);
            const updated = Date.parse(metadata.dateUpdated);
            if (!Number.isFinite(updated) || updated > previousUpdated || seen.has(metadata.id)
              || (metadata.locationId && metadata.locationId !== scope.locationId)) throw new Error("Invalid GoHighLevel contact pagination");
            previousUpdated = updated; seen.add(metadata.id);
            if (updated < cutoff) { complete = true; break; }
            if (contacts.has(metadata.id)) contacts.set(metadata.id, validate(raw));
          }
          if (complete || seen.size >= result.total) { complete = true; break; }
          if (result.contacts.length < 500) throw new Error("Incomplete GoHighLevel contact page");
        }
      } catch (error) { if (!unsupported(error)) throw error; canSearch = false; }
      if (!complete) {
        await fetchIds([...new Set([...contacts.keys(), ...required])]);
        fullCheckedAt = now.getTime();
      }
      checkedAt = now.getTime();
    } else if (stale || force) {
      await fetchIds([...new Set([...contacts.keys(), ...required])]);
      checkedAt = now.getTime();
      fullCheckedAt = now.getTime();
    }
    await fetchIds(required.filter((id) => !contacts.has(id)));
    // Cache only the validated ID, tags and dates, never provider contact details.
    if (changed) await store.write(key, { version: 1, checkedAt, fullCheckedAt, contacts: Object.fromEntries(contacts) }).catch(() => undefined);
    return new Map(required.map((id) => [id, contacts.get(id)!]));
  } finally { release(); if (queues.get(key) === pending) queues.delete(key); }
}
