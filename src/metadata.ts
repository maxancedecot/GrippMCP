import { createRequire } from "node:module";
import { GrippClass, GrippMetadata } from "./types.js";

const require = createRequire(import.meta.url);
const rawMetadata = require("./generated/gripp_api_metadata.json") as GrippMetadata;

export const metadata = rawMetadata as GrippMetadata;

const classByName = new Map(metadata.classes.map((apiClass) => [apiClass.name.toLowerCase(), apiClass]));

export function listClassSummaries() {
  return metadata.classes.map((apiClass) => ({
    name: apiClass.name,
    description: apiClass.description || undefined,
    tableName: apiClass.tableName,
    fields: apiClass.fields.length,
    methods: apiClass.methods.map((method) => method.name)
  }));
}

export function getClass(name: string): GrippClass | undefined {
  return classByName.get(name.toLowerCase());
}

export function requireClass(name: string): GrippClass {
  const apiClass = getClass(name);
  if (!apiClass) {
    const known = metadata.classes.map((item) => item.name).sort();
    throw new Error(`Unknown Gripp entity '${name}'. Known entities: ${known.join(", ")}`);
  }
  return apiClass;
}

export function hasMethod(entity: string, method: string): boolean {
  const apiClass = getClass(entity);
  return Boolean(apiClass?.methods.some((candidate) => candidate.name === method));
}

export function requireMethod(entity: string, method: string): void {
  const apiClass = requireClass(entity);
  if (!apiClass.methods.some((candidate) => candidate.name === method)) {
    throw new Error(
      `Entity '${apiClass.name}' does not expose method '${method}'. Available methods: ${apiClass.methods
        .map((candidate) => candidate.name)
        .join(", ")}`
    );
  }
}

export function getEntityDetails(name: string) {
  const apiClass = requireClass(name);
  return {
    name: apiClass.name,
    description: apiClass.description || undefined,
    tableName: apiClass.tableName,
    fields: apiClass.fields,
    methods: apiClass.methods.map((method) => ({
      name: method.name,
      description: method.description || undefined,
      params: method.params,
      returns: method.returns,
      version: method.version,
      example: method.example
    }))
  };
}

export function methodName(entity: string, method: string): string {
  requireMethod(entity, method);
  return `${requireClass(entity).name}.${method}`;
}
