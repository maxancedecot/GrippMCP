import { GrippMcpError } from "./errors.js";

export type StripeCrmRevenuePeriod = {
  start: string;
  end: string;
};

export type StripeCrmRevenueMonth = {
  key: string;
  label: string;
  revenue: number;
};

export type StripeCrmRevenueSourceMode = "live" | "not_configured" | "unavailable" | "demo";

export type StripeCrmRevenue = {
  amount: number;
  transactionCount: number;
  fetchedTransactionCount: number;
  ignoredCurrencyCount: number;
  availableCurrencies: string[];
  currency: string;
  vatRate: number;
  source: {
    mode: StripeCrmRevenueSourceMode;
    message: string;
  };
  byMonth: StripeCrmRevenueMonth[];
};

export type StripeCrmRevenueOptions = {
  secretKey?: string;
  accountId?: string;
  currency?: string;
  vatRate?: number | string;
  fetchImpl?: FetchLike;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type StripeSecretKeyMode = "live" | "test" | "configured";

export type StripeBalanceTransaction = {
  id: string;
  amount: number;
  created: number;
  currency: string;
  type: string;
  reportingCategory?: string;
};

const STRIPE_BALANCE_TRANSACTIONS_URL = "https://api.stripe.com/v1/balance_transactions";
const STRIPE_BALANCE_TRANSACTION_LIMIT = 100;
const STRIPE_BALANCE_TRANSACTION_MAX_PAGES_PER_TYPE = 100;
const STRIPE_REVENUE_TRANSACTION_TYPES = [
  "charge",
  "payment",
  "refund",
  "payment_refund",
  "payment_failure_refund",
  "payment_reversal",
  "refund_failure"
] as const;
const STRIPE_REVENUE_REVERSAL_TYPES = new Set(["payment_reversal", "refund_failure"]);
const STRIPE_REVENUE_REPORTING_CATEGORIES = new Set(["charge", "refund", "partial_capture_reversal", "charge_failure"]);
const DEFAULT_STRIPE_REVENUE_CURRENCY = "eur";
const DEFAULT_STRIPE_REVENUE_VAT_RATE = 21;
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf"
]);

export async function fetchStripeCrmRevenueForPeriod(
  period: StripeCrmRevenuePeriod,
  options: StripeCrmRevenueOptions = {}
): Promise<StripeCrmRevenue> {
  const secretKey = normalizeStripeSecretKey(options.secretKey ?? process.env.STRIPE_SECRET_KEY);
  const currency = normalizeStripeCurrency(options.currency ?? process.env.PM_STRIPE_REVENUE_CURRENCY);
  if (!secretKey) {
    return emptyStripeCrmRevenue(period, {
      currency,
      mode: "not_configured",
      message: "Zet STRIPE_SECRET_KEY om CRM omzet via Stripe te tonen."
    });
  }
  if (isPublishableStripeKey(secretKey)) {
    return unavailableStripeCrmRevenue(period, currency, "STRIPE_SECRET_KEY gebruikt een publishable key. Gebruik een Stripe secret key met prefix sk_live_ voor live omzet.");
  }
  if (!isSupportedStripeApiKey(secretKey)) {
    return unavailableStripeCrmRevenue(period, currency, "STRIPE_SECRET_KEY heeft geen geldige Stripe secret key prefix. Gebruik sk_live_, sk_test_, rk_live_ of rk_test_.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`
  };
  const vatRate = normalizeStripeVatRate(options.vatRate ?? process.env.PM_STRIPE_REVENUE_VAT_RATE);
  const accountId = (options.accountId ?? process.env.PM_STRIPE_ACCOUNT_ID ?? "").trim();
  if (accountId) {
    headers["Stripe-Account"] = accountId;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const transactions: StripeBalanceTransaction[] = [];
  for (const type of STRIPE_REVENUE_TRANSACTION_TYPES) {
    transactions.push(
      ...(await fetchStripeBalanceTransactionsForType({
        period,
        type,
        headers,
        fetchImpl
      }))
    );
  }

  const revenue = summarizeStripeCrmRevenue(transactions, period, currency, {
    mode: "live",
    message: ""
  }, vatRate);

  return {
    ...revenue,
    source: {
      ...revenue.source,
      message: stripeCrmRevenueSourceMessage(revenue, accountId, stripeSecretKeyMode(secretKey))
    }
  };
}

export function unavailableStripeCrmRevenue(period: StripeCrmRevenuePeriod, currency?: string, message?: string): StripeCrmRevenue {
  return emptyStripeCrmRevenue(period, {
    currency: normalizeStripeCurrency(currency ?? process.env.PM_STRIPE_REVENUE_CURRENCY),
    mode: "unavailable",
    message: message ?? "CRM omzet via Stripe kon niet worden geladen."
  });
}

export function demoStripeCrmRevenue(period: StripeCrmRevenuePeriod): StripeCrmRevenue {
  const vatRate = normalizeStripeVatRate(process.env.PM_STRIPE_REVENUE_VAT_RATE);
  const byMonth = monthBucketsForPeriod(period).map((bucket, index) => ({
    ...bucket,
    revenue: roundCurrency(amountExcludingVat([4200, 4800, 5100, 4550, 5750, 6100][index % 6], vatRate))
  }));

  return {
    amount: roundCurrency(byMonth.reduce((total, month) => total + month.revenue, 0)),
    transactionCount: byMonth.length,
    fetchedTransactionCount: byMonth.length,
    ignoredCurrencyCount: 0,
    availableCurrencies: [DEFAULT_STRIPE_REVENUE_CURRENCY],
    currency: DEFAULT_STRIPE_REVENUE_CURRENCY,
    vatRate,
    source: {
      mode: "demo",
      message: `Demo CRM omzet via Stripe, excl. ${formatVatRate(vatRate)}% btw.`
    },
    byMonth
  };
}

export function summarizeStripeCrmRevenue(
  transactions: StripeBalanceTransaction[],
  period: StripeCrmRevenuePeriod,
  currency = DEFAULT_STRIPE_REVENUE_CURRENCY,
  source: StripeCrmRevenue["source"] = {
    mode: "live",
    message: "CRM omzet geladen via Stripe balance transactions."
  },
  vatRate: number | string | undefined = DEFAULT_STRIPE_REVENUE_VAT_RATE
): StripeCrmRevenue {
  const normalizedCurrency = normalizeStripeCurrency(currency);
  const divisor = minorUnitDivisor(normalizedCurrency);
  const normalizedVatRate = normalizeStripeVatRate(vatRate);
  const revenueByMonth = new Map(monthBucketsForPeriod(period).map((bucket) => [bucket.key, 0]));
  let amount = 0;
  let transactionCount = 0;
  let fetchedTransactionCount = 0;
  let ignoredCurrencyCount = 0;
  const availableCurrencies = new Set<string>();

  for (const transaction of transactions) {
    if (!isStripeRevenueTransaction(transaction)) {
      continue;
    }

    const date = dateKeyFromUnixSeconds(transaction.created);
    if (!date || date < period.start || date > period.end) {
      continue;
    }

    fetchedTransactionCount += 1;
    availableCurrencies.add(transaction.currency);
    if (transaction.currency !== normalizedCurrency) {
      ignoredCurrencyCount += 1;
      continue;
    }

    const monthKey = date.slice(0, 7);
    if (!revenueByMonth.has(monthKey)) {
      continue;
    }

    const value = amountExcludingVat(transaction.amount / divisor, normalizedVatRate);
    amount += value;
    transactionCount += 1;
    revenueByMonth.set(monthKey, (revenueByMonth.get(monthKey) ?? 0) + value);
  }

  return {
    amount: roundCurrency(amount),
    transactionCount,
    fetchedTransactionCount,
    ignoredCurrencyCount,
    availableCurrencies: Array.from(availableCurrencies).sort(),
    currency: normalizedCurrency,
    vatRate: normalizedVatRate,
    source,
    byMonth: monthBucketsForPeriod(period).map((bucket) => ({
      ...bucket,
      revenue: roundCurrency(revenueByMonth.get(bucket.key) ?? 0)
    }))
  };
}

async function fetchStripeBalanceTransactionsForType({
  period,
  type,
  headers,
  fetchImpl
}: {
  period: StripeCrmRevenuePeriod;
  type: (typeof STRIPE_REVENUE_TRANSACTION_TYPES)[number];
  headers: Record<string, string>;
  fetchImpl: FetchLike;
}) {
  const transactions: StripeBalanceTransaction[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < STRIPE_BALANCE_TRANSACTION_MAX_PAGES_PER_TYPE; page += 1) {
    const response = await fetchImpl(stripeBalanceTransactionsUrl(period, type, startingAfter), {
      method: "GET",
      headers,
      cache: "no-store"
    });

    if (!response.ok) {
      const stripeError = await stripeResponseError(response);
      throw new GrippMcpError("stripe_http_error", `Stripe API gaf HTTP ${response.status}: ${stripeError.message}`, {
        status: response.status,
        stripeErrorCode: stripeError.code,
        stripeErrorMessage: stripeError.message,
        stripeErrorType: stripeError.type
      });
    }

    const payload = asRecord(await response.json());
    if (!payload || !Array.isArray(payload.data)) {
      throw new GrippMcpError("stripe_invalid_response", "Stripe API gaf geen geldige balance transaction lijst terug.");
    }

    const pageTransactions = payload.data.map(toStripeBalanceTransaction).filter((transaction): transaction is StripeBalanceTransaction => Boolean(transaction));
    transactions.push(...pageTransactions);

    if (payload.has_more !== true) {
      return transactions;
    }

    startingAfter = pageTransactions.at(-1)?.id;
    if (!startingAfter) {
      throw new GrippMcpError("stripe_invalid_response", "Stripe paginatie bevat geen laatste transaction id.");
    }
  }

  throw new GrippMcpError("stripe_pagination_limit", "Stripe balance transactions overschreden de ingestelde paginatielimiet.");
}

function stripeBalanceTransactionsUrl(
  period: StripeCrmRevenuePeriod,
  type: (typeof STRIPE_REVENUE_TRANSACTION_TYPES)[number],
  startingAfter?: string
) {
  const params = new URLSearchParams({
    limit: String(STRIPE_BALANCE_TRANSACTION_LIMIT),
    type,
    "created[gte]": String(unixSecondsForDateStart(period.start)),
    "created[lte]": String(unixSecondsForDateEnd(period.end))
  });
  if (startingAfter) {
    params.set("starting_after", startingAfter);
  }

  return `${STRIPE_BALANCE_TRANSACTIONS_URL}?${params.toString()}`;
}

function toStripeBalanceTransaction(value: unknown): StripeBalanceTransaction | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = stringFrom(record.id);
  const amount = numberFrom(record.amount);
  const created = numberFrom(record.created);
  const currency = normalizeStripeCurrency(stringFrom(record.currency));
  const type = stringFrom(record.type);
  if (!id || amount === null || created === null || !type) {
    return null;
  }

  return {
    id,
    amount,
    created,
    currency,
    type,
    reportingCategory: stringFrom(record.reporting_category)
  };
}

function emptyStripeCrmRevenue(
  period: StripeCrmRevenuePeriod,
  {
    currency,
    mode,
    message
  }: {
    currency: string;
    mode: StripeCrmRevenueSourceMode;
    message: string;
  }
): StripeCrmRevenue {
  return {
    amount: 0,
    transactionCount: 0,
    fetchedTransactionCount: 0,
    ignoredCurrencyCount: 0,
    availableCurrencies: [],
    currency,
    vatRate: normalizeStripeVatRate(process.env.PM_STRIPE_REVENUE_VAT_RATE),
    source: { mode, message },
    byMonth: monthBucketsForPeriod(period)
  };
}

function isStripeRevenueTransaction(transaction: StripeBalanceTransaction) {
  if (!transaction.reportingCategory) {
    return true;
  }

  return STRIPE_REVENUE_REPORTING_CATEGORIES.has(transaction.reportingCategory) || STRIPE_REVENUE_REVERSAL_TYPES.has(transaction.type);
}

function stripeCrmRevenueSourceMessage(revenue: StripeCrmRevenue, accountId: string, keyMode: StripeSecretKeyMode) {
  const currency = revenue.currency.toUpperCase();
  const keyModeLabel = keyMode === "live" ? "live key" : keyMode === "test" ? "test key" : "key";
  const accountScope = accountId ? "connected account" : "platform account";

  if (revenue.transactionCount > 0) {
    return `Stripe verbonden met ${keyModeLabel} op ${accountScope}; ${revenue.transactionCount} ${currency} omzetmutaties geladen, excl. ${formatVatRate(revenue.vatRate)}% btw.`;
  }

  if (revenue.fetchedTransactionCount > 0) {
    return `Stripe verbonden met ${keyModeLabel} op ${accountScope}; geen ${currency} omzetmutaties, wel ${revenue.fetchedTransactionCount} mutaties in ${revenue.availableCurrencies
      .map((currencyCode) => currencyCode.toUpperCase())
      .join(", ")}.`;
  }

  const connectHint = accountId ? "" : " Zet PM_STRIPE_ACCOUNT_ID=acct_... als CRM-betalingen op een Stripe Connect-account staan.";
  return `Stripe verbonden met ${keyModeLabel} op ${accountScope}; geen charge/refund mutaties gevonden in deze periode.${connectHint}`;
}

function stripeSecretKeyMode(secretKey: string): StripeSecretKeyMode {
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    return "live";
  }
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) {
    return "test";
  }

  return "configured";
}

function normalizeStripeSecretKey(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }

  return trimmed;
}

function isPublishableStripeKey(secretKey: string) {
  return secretKey.startsWith("pk_live_") || secretKey.startsWith("pk_test_");
}

function isSupportedStripeApiKey(secretKey: string) {
  return /^(sk|rk)_(live|test)_/.test(secretKey);
}

function monthBucketsForPeriod(period: StripeCrmRevenuePeriod): StripeCrmRevenueMonth[] {
  const start = parseDateKey(period.start);
  const end = parseDateKey(period.end);
  if (!start || !end) {
    return [];
  }

  const buckets: StripeCrmRevenueMonth[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

  while (cursor <= stop) {
    buckets.push({
      key: monthKey(cursor),
      label: new Intl.DateTimeFormat("nl-NL", { month: "short", year: "numeric" }).format(cursor),
      revenue: 0
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return buckets;
}

function normalizeStripeCurrency(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized?.match(/^[a-z]{3}$/) ? normalized : DEFAULT_STRIPE_REVENUE_CURRENCY;
}

function normalizeStripeVatRate(value: number | string | undefined) {
  const normalizedValue = typeof value === "string" ? value.trim().replace("%", "").replace(",", ".") : value;
  const rawValue = normalizedValue === "" || normalizedValue === undefined ? DEFAULT_STRIPE_REVENUE_VAT_RATE : Number(normalizedValue);
  if (!Number.isFinite(rawValue) || rawValue < 0) {
    return DEFAULT_STRIPE_REVENUE_VAT_RATE;
  }

  const percentage = rawValue > 0 && rawValue <= 1 ? rawValue * 100 : rawValue;
  return percentage <= 100 ? roundCurrency(percentage) : DEFAULT_STRIPE_REVENUE_VAT_RATE;
}

function amountExcludingVat(amount: number, vatRate: number) {
  return amount / (1 + vatRate / 100);
}

function formatVatRate(vatRate: number) {
  return Number.isInteger(vatRate) ? String(vatRate) : String(vatRate).replace(".", ",");
}

function minorUnitDivisor(currency: string) {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
}

function unixSecondsForDateStart(value: string) {
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 1000);
}

function unixSecondsForDateEnd(value: string) {
  return Math.floor(Date.parse(`${value}T23:59:59.999Z`) / 1000);
}

function dateKeyFromUnixSeconds(value: number) {
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function stripeResponseError(response: Response) {
  const body = await response.text().catch(() => "");
  if (!body) {
    return {
      message: response.statusText || "Onbekende Stripe fout"
    };
  }

  const parsed = safeJsonParse(body);
  const error = asRecord(asRecord(parsed)?.error);
  const message = stringFrom(error?.message);
  return {
    code: stringFrom(error?.code),
    message: message ?? body.slice(0, 180),
    type: stringFrom(error?.type)
  };
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}
