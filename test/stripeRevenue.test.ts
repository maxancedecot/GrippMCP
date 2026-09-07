import test from "node:test";
import assert from "node:assert/strict";
import { fetchStripeCrmRevenueForPeriod, summarizeStripeCrmRevenue, type StripeBalanceTransaction } from "../src/stripeRevenue.js";

const period = {
  start: "2026-01-01",
  end: "2026-02-28"
};

test("summarizeStripeCrmRevenue groups Stripe charges and refunds by month", () => {
  const transactions: StripeBalanceTransaction[] = [
    transaction("bt_charge_jan", 10000, "2026-01-05T12:00:00.000Z", "eur", "charge", "charge"),
    transaction("bt_refund_jan", -2000, "2026-01-12T12:00:00.000Z", "eur", "refund", "refund"),
    transaction("bt_payment_feb", 7500, "2026-02-04T12:00:00.000Z", "eur", "payment", "charge"),
    transaction("bt_fee_ignored", -350, "2026-02-04T12:00:00.000Z", "eur", "stripe_fee", "stripe_fee"),
    transaction("bt_usd_ignored", 2500, "2026-02-04T12:00:00.000Z", "usd", "charge", "charge"),
    transaction("bt_outside_ignored", 5000, "2026-03-01T00:00:00.000Z", "eur", "charge", "charge")
  ];

  const result = summarizeStripeCrmRevenue(transactions, period, "eur");

  assert.equal(result.amount, 155);
  assert.equal(result.transactionCount, 3);
  assert.deepEqual(
    result.byMonth.map((month) => [month.key, month.revenue]),
    [
      ["2026-01", 80],
      ["2026-02", 75]
    ]
  );
});

test("fetchStripeCrmRevenueForPeriod lists revenue transaction types with Stripe auth headers", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const parsedUrl = new URL(url);
    const type = parsedUrl.searchParams.get("type");
    const startingAfter = parsedUrl.searchParams.get("starting_after");

    if (type === "charge" && !startingAfter) {
      return stripeListResponse({
        has_more: true,
        data: [
          {
            id: "bt_charge_1",
            amount: 12000,
            created: timestamp("2026-01-15T12:00:00.000Z"),
            currency: "eur",
            type: "charge",
            reporting_category: "charge"
          }
        ]
      });
    }

    if (type === "charge" && startingAfter === "bt_charge_1") {
      return stripeListResponse({
        data: [
          {
            id: "bt_charge_2",
            amount: 8000,
            created: timestamp("2026-02-15T12:00:00.000Z"),
            currency: "eur",
            type: "charge",
            reporting_category: "charge"
          }
        ]
      });
    }

    if (type === "refund") {
      return stripeListResponse({
        data: [
          {
            id: "bt_refund_1",
            amount: -3000,
            created: timestamp("2026-02-20T12:00:00.000Z"),
            currency: "eur",
            type: "refund",
            reporting_category: "refund"
          }
        ]
      });
    }

    return stripeListResponse({ data: [] });
  }) as typeof fetch;

  const result = await fetchStripeCrmRevenueForPeriod(period, {
    secretKey: "sk_test_123",
    accountId: "acct_123",
    currency: "eur",
    fetchImpl
  });

  assert.equal(result.amount, 170);
  assert.equal(result.transactionCount, 3);
  assert.equal(calls.length, 8);

  const firstCall = calls[0];
  const headers = firstCall.init.headers as Record<string, string>;
  const firstUrl = new URL(firstCall.url);
  assert.equal(headers.Authorization, "Bearer sk_test_123");
  assert.equal(headers["Stripe-Account"], "acct_123");
  assert.equal(firstUrl.searchParams.get("currency"), "eur");
  assert.equal(firstUrl.searchParams.get("created[gte]"), String(timestamp("2026-01-01T00:00:00.000Z")));
  assert.equal(firstUrl.searchParams.get("created[lte]"), String(timestamp("2026-02-28T23:59:59.999Z")));
  assert.equal(firstUrl.searchParams.get("limit"), "100");
});

test("fetchStripeCrmRevenueForPeriod returns an empty source when Stripe is not configured", async () => {
  let called = false;
  const result = await fetchStripeCrmRevenueForPeriod(period, {
    secretKey: "",
    fetchImpl: (async () => {
      called = true;
      return stripeListResponse({ data: [] });
    }) as typeof fetch
  });

  assert.equal(called, false);
  assert.equal(result.amount, 0);
  assert.equal(result.transactionCount, 0);
  assert.equal(result.source.mode, "not_configured");
});

function transaction(
  id: string,
  amount: number,
  created: string,
  currency: string,
  type: string,
  reportingCategory: string
): StripeBalanceTransaction {
  return {
    id,
    amount,
    created: timestamp(created),
    currency,
    type,
    reportingCategory
  };
}

function timestamp(value: string) {
  return Math.floor(Date.parse(value) / 1000);
}

function stripeListResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify({ has_more: false, ...body }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
