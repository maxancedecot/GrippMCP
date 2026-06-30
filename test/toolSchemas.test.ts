import test from "node:test";
import assert from "node:assert/strict";
import { grippMethodNamePattern } from "../src/toolSchemas.js";

test("grippMethodNamePattern accepts documented Gripp method names", () => {
  assert.equal(grippMethodNamePattern.test("invoice.get"), true);
  assert.equal(grippMethodNamePattern.test("company.getCompanyByCOC"), true);
});

test("grippMethodNamePattern rejects malformed method names", () => {
  assert.equal(grippMethodNamePattern.test("invoice"), false);
  assert.equal(grippMethodNamePattern.test("invoice/get"), false);
  assert.equal(grippMethodNamePattern.test("invoice.get.extra"), false);
});
