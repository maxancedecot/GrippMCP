import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { CrmPipelineLoadError, crmPipelineLoadErrorMessage } from "../src/crmPipelineErrors.js";
import { GrippMcpError } from "../src/errors.js";

test("pipeline diagnostics identify the failed stage and status without exposing provider details", () => {
  for (const stage of ["installation_check", "location_connection", "pipelines"] as const) {
    const result = crmPipelineLoadErrorMessage(new CrmPipelineLoadError(stage,
      new GrippMcpError("ghl_upstream_error", "private-token", { status: 403, body: { email: "private-email", message: "private-token" } })));
    assert.match(result, /HTTP 403/);
    assert.match(result, /toegangsrechten/);
    assert.doesNotMatch(result, /private|email|body/);
    assert.match(result, stage === "installation_check" ? /app-installatie/ : stage === "location_connection" ? /CRM-verbinding/ : /CRM-pipelines/);
  }
  for (const [status, hint] of [[401, /opnieuw/], [429, /even later/], [503, /Probeer opnieuw/]] as const) {
    assert.match(crmPipelineLoadErrorMessage(new GrippMcpError("ghl_upstream_error", "private", { status })), hint);
  }
});

test("pipeline diagnostics distinguish installation, selection, refresh, schema, timeout and unknown failures", () => {
  assert.match(crmPipelineLoadErrorMessage(new CrmPipelineLoadError("installation_check",
    new GrippMcpError("crm_app_not_installed", "private"))), /niet geïnstalleerd of niet toegankelijk/);
  assert.match(crmPipelineLoadErrorMessage(new GrippMcpError("crm_connection_changed", "private")), /selectie is verouderd/);
  assert.match(crmPipelineLoadErrorMessage(new Error("GoHighLevel token refresh failed: private")), /opnieuw worden verbonden/);
  const schema = new z.ZodError([{ code: "custom", message: "private", path: ["items", 3, "isInstalled"] }]);
  const result = crmPipelineLoadErrorMessage(new CrmPipelineLoadError("installation_check", schema));
  assert.match(result, /items.isInstalled/); assert.doesNotMatch(result, /private|3/);
  assert.match(crmPipelineLoadErrorMessage(new DOMException("private", "TimeoutError")), /niet op tijd/);
  assert.doesNotMatch(crmPipelineLoadErrorMessage(new Error("private")), /private/);
});
