import { describe, expect, it } from "vitest";
import { simulateMulliganStrategy } from "../mulligan";

describe("simulateMulliganStrategy", () => {
  it("returns rates that sum to 1 and stay within [0,1]", () => {
    const result = simulateMulliganStrategy({
      deckSize: 99,
      lands: 37,
      trials: 5000,
      seed: 1,
    });
    expect(result.keepRate + result.forcedKeepRate).toBeCloseTo(1, 6);
    expect(result.keepRate).toBeGreaterThan(0);
    expect(result.keepRate).toBeLessThanOrEqual(1);
    expect(result.averageMulligans).toBeGreaterThanOrEqual(0);
    expect(result.averageMulligans).toBeLessThanOrEqual(3);
  });

  it("has a much higher keep rate for a reasonable land count than for a very low one", () => {
    const good = simulateMulliganStrategy({ deckSize: 99, lands: 37, trials: 8000, seed: 2 });
    const bad = simulateMulliganStrategy({ deckSize: 99, lands: 10, trials: 8000, seed: 2 });
    expect(good.keepRate).toBeGreaterThan(bad.keepRate);
  });

  it("never needs more mulligans than the configured maximum", () => {
    const result = simulateMulliganStrategy({
      deckSize: 99,
      lands: 5,
      trials: 3000,
      maxMulligans: 2,
      seed: 3,
    });
    expect(result.averageMulligans).toBeLessThanOrEqual(2);
    expect(result.averageFinalHandSize).toBeGreaterThanOrEqual(5);
  });

  it("keeps average lands in the final hand within a sane range", () => {
    const result = simulateMulliganStrategy({ deckSize: 99, lands: 37, trials: 5000, seed: 4 });
    expect(result.averageLandsInFinalHand).toBeGreaterThan(0);
    expect(result.averageLandsInFinalHand).toBeLessThanOrEqual(7);
  });
});
