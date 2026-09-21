export const CAMPAIGN_CTR_BENCHMARK_PERCENT = 1;
export const PROJECT_CVR_BENCHMARK_PERCENT = 2;

export type CampaignBenchmarkComparison = {
  below: number;
  measured: number;
  benchmark: number;
};

export function campaignBenchmarkComparison(values: number[], benchmark: number): CampaignBenchmarkComparison {
  const measuredValues = values.filter(Number.isFinite);
  return {
    below: measuredValues.filter((value) => value < benchmark).length,
    measured: measuredValues.length,
    benchmark
  };
}
