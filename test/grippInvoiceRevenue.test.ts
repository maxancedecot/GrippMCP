import test from "node:test";
import assert from "node:assert/strict";
import { isGrippCreditInvoice, signedGrippAgencyInvoiceRevenueAmount, signedGrippInvoiceLineRevenueAmount, signedGrippInvoiceRevenueAmount } from "../src/grippInvoiceRevenue.js";

test("agency revenue removes only the external cost lines from mixed invoices", () => {
  const lines = [
    { product: { name: "Grafisch ontwerp" }, amount: 1, sellingprice: 1000 },
    { product: { name: "Advertentie budgetten - Meta & Google - per kwartaal" }, amount: 1, sellingprice: 500 },
    { product: { name: "Hosting & Domeinnaam" }, amount: 1, sellingprice: 100 },
    { product: { name: "Drukwerk" }, additionalsubject: "Drukwerk 15.000 flyers", amount: 1, sellingprice: 200 },
    { product: { name: "Dibond-prints" }, amount: 1, sellingprice: 50 },
    { product: { name: "Doorfacturatie" }, amount: 1, sellingprice: 150 },
    { rowtype: "GROUP", additionalsubject: "Drukwerk", amount: 1, sellingprice: 200 }
  ];
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject: "Marketingcampagne" }, 2000, lines), 1000);
});

test("agency revenue recognizes invoiced descriptions and namespaced product names", () => {
  for (const line of [
    { additionalsubject: "Drukwerk 15.000 flyers" },
    { "invoiceline.description": "Doorfacturatie kosten" },
    { "invoiceline.product": { "product.id": 95, "product.name": "Dibond-prints" } }
  ]) {
    assert.equal(signedGrippAgencyInvoiceRevenueAmount({}, 1000, [{ ...line, amount: 1, sellingprice: 200 }]), 800);
  }
});

test("agency revenue keeps design work and excludes recurring CRM charges", () => {
  const lines = [
    { product: { name: "Ontwerp brochure" }, description: "Ontwerp voor drukwerk", amount: 1, sellingprice: 1000 },
    { product: { name: "Werfbord" }, amount: 4, sellingprice: 100 },
    { product: { name: "Ledoux CRM licentie per maand" }, amount: 1, sellingprice: 299 },
    { product: { name: "Credits Ledoux CRM" }, amount: 1, sellingprice: 50 }
  ];
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({}, 1749, lines), 1400);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({}, 1000, [
    { product: { name: "Campagne onderhoud + support" }, description: "Advertentiebudgetten en hosting worden apart gefactureerd", amount: 1, sellingprice: 1000 }
  ]), 1000);
});

test("agency invoices and their full credits cancel after external cost exclusions", () => {
  const lines = [{ product: { name: "Hosting & Domeinnaam" }, amount: 1, sellingprice: 200 }];
  const original = signedGrippAgencyInvoiceRevenueAmount({ subject: "Website" }, 1000, lines);
  const credit = signedGrippAgencyInvoiceRevenueAmount({ subject: "Creditfactuur van 20260001: Website" }, 1000, lines);
  assert.equal(original, 800);
  assert.equal(credit, -800);
  assert.equal(original! + credit!, 0);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount(
    { totalincldiscountexclvat: -1000 }, -1000,
    [{ product: { name: "Hosting & Domeinnaam" }, amount: -1, sellingprice: 200 }]
  ), -800);
});

test("the actual CRM and budget invoice and credit both contribute zero agency revenue", () => {
  const lines = [
    { product: { name: "Ledoux CRM licentie per maand" }, amount: 3, sellingprice: 299 },
    { product: { name: "Advertentie budgetten - Meta & Google - per kwartaal" }, amount: 1, sellingprice: 3780 }
  ];
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject: "LEDOUX CRM + ad budgetten (3 maanden)" }, 4677, lines), 0);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject: "Creditfactuur van 20260282: LEDOUX CRM + ad budgetten" }, 4677, lines), 0);
});

test("external cost lines use net discounted amounts and credit signs", () => {
  const line = { amount: 2, sellingprice: 100, discount: 10 };
  assert.equal(signedGrippInvoiceLineRevenueAmount(line, {}), 180);
  assert.equal(signedGrippInvoiceLineRevenueAmount(line, { iscreditnote: true }), -180);
  assert.equal(signedGrippInvoiceLineRevenueAmount({ totalexclvat: 125, ...line }, {}), 125);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({}, 1000, [{ ...line, additionalsubject: "Drukwerk" }]), 820);
});

test("agency revenue remains unavailable when exclusion data is incomplete", () => {
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({}, 1000, null), null);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({}, 1000, [{ product: 123, amount: 1, sellingprice: 200 }]), null);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({}, 1000, [{ additionalsubject: "Drukwerk" }]), null);
  assert.equal(signedGrippAgencyInvoiceRevenueAmount({ subject: "Office Center diensten" }, 1000, null), 0);
});

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
