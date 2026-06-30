#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_URL = "https://api.gripp.com/public/api3.php";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, "../src/generated/gripp_api_metadata.json");

function extractApiObject(source) {
  const marker = "var api = ";
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error("Could not find `var api =` in the Gripp API docs page.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  const objectStart = start + marker.length;

  for (let i = objectStart; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(source.slice(objectStart, i + 1));
      }
    }
  }

  throw new Error("Could not find the end of the embedded Gripp API metadata object.");
}

function compactMetadata(api) {
  return {
    source: DOCS_URL,
    generatedAt: new Date().toISOString(),
    classes: (api.classes ?? []).map((apiClass) => ({
      name: apiClass.name,
      description: (apiClass.desc ?? "").trim(),
      tableName: apiClass.tablename,
      fields: (apiClass.fields ?? []).map((field) => ({
        name: field.name,
        type: field.type,
        description: field.description,
        readonly: Boolean(field.readonly),
        required: Boolean(field.required),
        reference: field.reference,
        relation: field.relation,
        values: field.referenceList
      })),
      methods: (apiClass.methods ?? []).map((method) => ({
        name: method.name,
        description: [method.shortDesc, method.longDesc].filter(Boolean).join("\n").trim(),
        params: method.params,
        returns: method.return,
        version: method.version,
        example: method.example
      }))
    }))
  };
}

async function main() {
  const response = await fetch(DOCS_URL, {
    headers: {
      "User-Agent": "gripp-mcp metadata generator"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${DOCS_URL}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const api = extractApiObject(html);
  const metadata = compactMetadata(api);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);

  const methodCount = metadata.classes.reduce((count, apiClass) => count + apiClass.methods.length, 0);
  console.log(`Wrote ${metadata.classes.length} classes and ${methodCount} methods to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
