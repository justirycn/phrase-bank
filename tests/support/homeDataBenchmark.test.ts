import { describe, expect, it } from "vitest";
import { runHomeDataBenchmark } from "./homeDataBenchmark";

describe("2,000 phrase home-data benchmark", () => {
  it("uses deterministic realistic data and bounded startup reads", async () => {
    const report = await runHomeDataBenchmark();

    expect(report.fixture).toEqual({
      seed: 20260811,
      phrases: 2_000,
      categories: 10,
      learningStates: 2_000,
      events: 10_080,
      trainingSessions: 1_440,
    });
    expect(report.calls).toEqual({
      listPhrases: 1,
      listCategories: 1,
      listDuePhrases: 1,
      listTrainingEvents: 1,
      listTrainingSessions: 1,
      listPhraseLearningStates: 1,
      getActiveTrainingSession: 1,
      getActiveLearningSession: 1,
      exportSnapshot: 0,
    });
    expect(report.rows.trainingEvents).toBe(6_636);
    expect(report.rows.trainingSessions).toBe(948);
    expect(report.rows.heatmapDays).toBe(84);
    expect(report.serviceReadyMilliseconds).toBeLessThan(5_000);
  }, 30_000);
});
