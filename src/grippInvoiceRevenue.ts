export type GrippInvoiceRecord = Record<string, unknown>;

const CREDIT_INVOICE_FLAG_FIELDS = ["iscreditnote", "iscreditnota", "iscreditinvoice", "creditnote", "creditnota", "creditinvoice", "iscredit"];
const CREDIT_INVOICE_TEXT_FIELDS = ["searchname", "subject", "description", "type", "kind", "invoicetype", "invoicekind", "factuurtype", "factuursoort", "phase", "fase"];
const CREDIT_INVOICE_NEGATIVE_TOTAL_FIELDS = ["totalincldiscountexclvat", "totalincldiscountinclvat", "totalinclvat"];
const CREDIT_INVOICE_TEXT_MARKERS = ["creditnota", "creditfactuur", "creditnote", "creditinvoice", "creditmemo", "creditering"];

export function signedGrippInvoiceRevenueAmount(invoice: GrippInvoiceRecord, amount: number) {
  if (amount < 0) {
    return amount;
  }

  return isGrippCreditInvoice(invoice) ? -Math.abs(amount) : amount;
}

export function isGrippCreditInvoice(invoice: GrippInvoiceRecord) {
  if (hasNegativeInvoiceTotal(invoice)) {
    return true;
  }

  for (const field of CREDIT_INVOICE_FLAG_FIELDS) {
    const value = readField(invoice, field);
    if (booleanFrom(value) === true || hasCreditInvoiceTextMarker(value)) {
      return true;
    }
  }

  const debitCreditValues = [...textValuesFrom(readField(invoice, "debitcredit")), ...textValuesFrom(readField(invoice, "debetcredit"))].map(normalizeComparisonValue);
  if (debitCreditValues.includes("credit")) {
    return true;
  }

  return creditInvoiceTextValues(invoice).some((value) => hasCreditInvoiceTextMarker(value));
}

function hasNegativeInvoiceTotal(invoice: GrippInvoiceRecord) {
  return CREDIT_INVOICE_NEGATIVE_TOTAL_FIELDS.some((field) => {
    const amount = numberFrom(readField(invoice, field));
    return amount !== null && amount < 0;
  });
}

function creditInvoiceTextValues(invoice: GrippInvoiceRecord) {
  const values: unknown[] = CREDIT_INVOICE_TEXT_FIELDS.map((field) => readField(invoice, field));

  for (const [key, value] of Object.entries(invoice)) {
    if (isCreditInvoiceHintKey(key)) {
      values.push(value);
    }
  }

  return values.flatMap(textValuesFrom);
}

function isCreditInvoiceHintKey(key: string) {
  const normalized = key.toLowerCase().replace(/[._-]/g, "");
  return (
    normalized.includes("credit") ||
    normalized.includes("debitcredit") ||
    normalized.includes("debetcredit") ||
    normalized.includes("invoicetype") ||
    normalized.includes("invoicekind") ||
    normalized.includes("factuurtype") ||
    normalized.includes("factuursoort")
  );
}

function hasCreditInvoiceTextMarker(value: unknown) {
  return textValuesFrom(value).some((entry) => {
    const normalized = normalizeComparisonValue(entry);
    return normalized === "credit" || CREDIT_INVOICE_TEXT_MARKERS.some((marker) => normalized.includes(marker));
  });
}

function textValuesFrom(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  return ["value", "rawValue", "rawvalue", "displayvalue", "displayValue", "label", "name", "searchname", "screenname"]
    .map((key) => stringFrom(record[key]))
    .filter((entry): entry is string => Boolean(entry));
}

function readField(record: GrippInvoiceRecord | undefined, field: string) {
  if (!record) {
    return undefined;
  }

  const direct = record[field] ?? record[`invoice.${field}`];
  if (direct !== undefined) {
    return direct;
  }

  const suffix = `.${field.toLowerCase()}`;
  const matchingKey = Object.keys(record).find((key) => key.toLowerCase().endsWith(suffix));
  return matchingKey ? record[matchingKey] : undefined;
}

function numberFrom(value: unknown): number | null {
  const scalar = scalarFrom(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof scalar === "number" && Number.isFinite(scalar)) {
    return scalar;
  }

  if (typeof scalar === "string") {
    const normalized = normalizeNumberString(scalar);
    if (normalized && Number.isFinite(Number(normalized))) {
      return Number(normalized);
    }
  }

  return null;
}

function stringFrom(value: unknown): string | undefined {
  const scalar = scalarFrom(value);
  if (typeof scalar === "string") {
    return scalar.trim() || undefined;
  }

  if (typeof scalar === "number" || typeof scalar === "boolean") {
    return String(scalar);
  }

  return undefined;
}

function booleanFrom(value: unknown): boolean | undefined {
  const scalar = scalarFrom(value);
  if (typeof scalar === "boolean") {
    return scalar;
  }

  if (typeof scalar === "number") {
    return scalar !== 0;
  }

  if (typeof scalar === "string") {
    const normalized = scalar.toLowerCase();
    if (["true", "1", "yes", "ja"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "nee"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function scalarFrom(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return value;
  }

  for (const key of ["value", "rawValue", "rawvalue", "id", "displayvalue", "displayValue", "label", "name", "searchname", "screenname"]) {
    if (record[key] !== undefined && record[key] !== null) {
      return scalarFrom(record[key]);
    }
  }

  return value;
}

function asRecord(value: unknown): GrippInvoiceRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as GrippInvoiceRecord) : undefined;
}

function normalizeNumberString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.includes(",") && trimmed.includes(".")) {
    return trimmed.replace(/\./g, "").replace(",", ".");
  }

  return trimmed.replace(",", ".");
}

function normalizeComparisonValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
