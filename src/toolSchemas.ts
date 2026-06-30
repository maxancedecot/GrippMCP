import { z } from "zod";
import { JsonValue } from "./types.js";

export const grippMethodNamePattern = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);

export const filterSchema = z.object({
  field: z.string().describe("Full Gripp field name, for example company.id or invoice.number."),
  operator: z
    .enum([
      "in",
      "notin",
      "equals",
      "notequals",
      "between",
      "greaterequals",
      "greater",
      "lessequals",
      "less",
      "like",
      "isnull",
      "isnotnull"
    ])
    .describe("Gripp filter operator."),
  value: jsonValueSchema.optional().describe("Filter value. Required by most operators."),
  value2: jsonValueSchema.optional().describe("Second filter value, used by between.")
});

export const optionsSchema = z
  .object({
    paging: z
      .object({
        firstresult: z.number().int().min(0).default(0),
        maxresults: z.number().int().min(1).max(250).default(25)
      })
      .optional()
      .describe("Paging options. Gripp caps maxresults at 250."),
    orderings: z
      .array(
        z.object({
          field: z.string().describe("Full Gripp field name, for example company.companyname."),
          direction: z.enum(["asc", "desc"])
        })
      )
      .optional()
  })
  .default({});
