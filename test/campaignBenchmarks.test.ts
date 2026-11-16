import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_CTR_BENCHMARK_PERCENT,
  GOOGLE_CTR_BENCHMARK_PERCENT,
  PROJECT_CVR_BENCHMARK_PERCENT,
  campaignBenchmarkComparison
} from "../src/campaignBenchmarks.js";

test("campaign benchmark counts use the same CTR boundary as red and green values", () => {
  assert.deepEqual(campaignBenchmarkComparison([0.4, 0.99, 1, 2.4], CAMPAIGN_CTR_BENCHMARK_PERCENT), {
    below: 2,
    measured: 4,
    benchmark: 1
  });
});

test("project CVR benchmark treats the green boundary as not below average", () => {
  assert.deepEqual(campaignBenchmarkComparison([0, 1.99, 2, 4, Number.NaN], PROJECT_CVR_BENCHMARK_PERCENT), {
    below: 2,
    measured: 4,
    benchmark: 2
  });
});

test("Google CTR uses a 10 percent boundary and includes exactly 10 percent as meeting the benchmark", () => {
  assert.deepEqual(campaignBenchmarkComparison([1, 9.99, 10, 12, Number.NaN], GOOGLE_CTR_BENCHMARK_PERCENT), {
    below: 2,
    measured: 4,
    benchmark: 10
  });
});
