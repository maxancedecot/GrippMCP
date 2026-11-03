import test from "node:test";
import assert from "node:assert/strict";
import { isGrippCreditInvoice, signedGrippAgencyInvoiceRevenueAmount, signedGrippInvoiceRevenueAmount } from "../src/grippInvoiceRevenue.js";

test("agency revenue excludes Office Center invoice subjects regardless of case or separators", () => {
  for (const subject of ["Office Center diensten", "Maandelijkse OFFICE CENTER diensten", "Office-Center diensten", "OfficeCenter diensten"]) {
    assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject }, 1000), 0);
    assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject, iscreditnote: true }, 250), 0);
    assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject }, -250), 0);
  }
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({ "invoice.subject": { value: "Office Center diensten" } }, 1000), 0);
});

test("agency revenue keeps other invoice subjects and subtracts agency credit notes", () => {
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject: "Website", description: "Office Center diensten" }, 1000), 1000);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject: "Creditnota website" }, 250), -250);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject: "Website" }, -250), -250);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({}, 1000), 1000);
});

test("signedGrippInvoiceRevenueAmount keeps regular invoices positive", () => {
  const invoice = {
    status: "SENT",
    subject: "Website onderhoud",
    totalincldiscountexclvat: 1000
  };

  assert.equal(isGrippCreditInvoice(invoice), false);
  assert.equal(signedGrippInvoiceRevenueAmount(invoice, 1000), 1000);
});

test("signedGrippInvoiceRevenueAmount keeps already negative invoice amounts negative", () => {
  const invoice = {
    status: "SENT",
    subject: "Correctie",
    totalincldiscountexclvat: -250
  };

  assert.equal(isGrippCreditInvoice(invoice), true);
  assert.equal(signedGrippInvoiceRevenueAmount(invoice, -250), -250);
});

test("signedGrippInvoiceRevenueAmount subtracts positive creditnota invoices", () => {
  const invoice = {
    status: "SENT",
    subject: "Creditnota factuur 2026-001",
    totalincldiscountexclvat: 250
  };

  assert.equal(isGrippCreditInvoice(invoice), true);
  assert.equal(signedGrippInvoiceRevenueAmount(invoice, 250), -250);
});

test("signedGrippInvoiceRevenueAmount detects explicit Gripp credit fields", () => {
  const invoice = {
    status: "SENT",
    "invoice.debitcredit": { id: 2, displayvalue: "Credit" },
    totalincldiscountexclvat: 400
  };

  assert.equal(isGrippCreditInvoice(invoice), true);
  assert.equal(signedGrippInvoiceRevenueAmount(invoice, 400), -400);
});

test("signedGrippInvoiceRevenueAmount detects exact credit invoice type values", () => {
  const invoice = {
    status: "SENT",
    "invoice.factuurtype": { id: 3, displayvalue: "Credit" },
    totalincldiscountexclvat: 325
  };

  assert.equal(isGrippCreditInvoice(invoice), true);
  assert.equal(signedGrippInvoiceRevenueAmount(invoice, 325), -325);
});

test("signedGrippInvoiceRevenueAmount does not treat creditcard text as a creditnota", () => {
  const invoice = {
    status: "SENT",
    subject: "Betaling via creditcard",
    totalincldiscountexclvat: 150
  };

  assert.equal(isGrippCreditInvoice(invoice), false);
  assert.equal(signedGrippInvoiceRevenueAmount(invoice, 150), 150);
});
