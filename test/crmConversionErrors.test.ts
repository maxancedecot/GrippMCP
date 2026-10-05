import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { crmConversionErrorMessage } from "../src/campaignPerformance.js";
import { GrippMcpError } from "../src/errors.js";

test("CRM diagnostics describe response failures without exposing provider data", () => {
  assert.equal(crmConversionErrorMessage(new GrippMcpError("ghl_upstream_error", "private-token", {
    status: 422, body: { message: "private-lead", token: "private-token" }
  })), "CRM niet beschikbaar (HTTP 422)");
  const error = new z.ZodError([{ code: "custom", message: "private-lead", path: ["opportunities", 7, "createdAt"] }]);
  assert.equal(crmConversionErrorMessage(error), "CRM-antwoord ongeldig (opportunities.createdAt)");
  assert.equal(crmConversionErrorMessage(new Error("No GoHighLevel OAuth installation found for install_id 'private-id'.")), "CRM-subaccount opnieuw verbinden");
  assert.equal(crmConversionErrorMessage(new Error("private-token")), "CRM niet beschikbaar");
});
