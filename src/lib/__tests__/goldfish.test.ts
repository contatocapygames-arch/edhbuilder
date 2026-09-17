import { describe, expect, it } from "vitest";
import { runGoldfishSimulation } from "../goldfish";

function flatCurve(nonlandCount: number, cmc: number) {
  return [{ cmc, count: nonlandCount }];
}

describe("runGoldfishSimulation", () => {
  it("throws when lands + curve exceed the deck size", () => {
    expect(() =>
      runGoldfishSimulation({
        deckSize: 99,
        lands: 37,
        curve: [{ cmc: 2, count: 70 }], // 37 + 70 > 99
        onPlay: true,
        maxTurn: 3,
        trials: 10,
      })
    ).toThrow();
  });

  it("gives a cheap curve a much better early legal-play rate than an expensive one", () => {
    const deckSize = 99;
    const lands = 37;
    const nonland = deckSize - lands;

    const cheap = runGoldfishSimulation({
      deckSize,
      lands,
      curve: flatCurve(nonland, 1),
      onPlay: true,
      maxTurn: 2,
      trials: 6000,
      seed: 1,
    });
    const expensive = runGoldfishSimulation({
      deckSize,
      lands,
      curve: flatCurve(nonland, 6),
      onPlay: true,
      maxTurn: 2,
      trials: 6000,
      seed: 1,
    });

    expect(cheap[0].legalPlayProbability).toBeGreaterThan(expensive[0].legalPlayProbability);
    expect(cheap[0].legalPlayProbability).toBeGreaterThan(0.8);
    expect(expensive[0].legalPlayProbability).toBeLessThan(0.1);
  });

  it("keeps average lands in play non-decreasing across turns", () => {
    const deckSize = 99;
    const lands = 37;
    const result = runGoldfishSimulation({
      deckSize,
      lands,
      curve: flatCurve(deckSize - lands, 3),
      onPlay: true,
      maxTurn: 8,
      trials: 4000,
      seed: 2,
    });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].averageLandsInPlay).toBeGreaterThanOrEqual(result[i - 1].averageLandsInPlay);
    }
  });

  it("never reports negative wasted mana", () => {
    const deckSize = 60;
    const lands = 24;
    const result = runGoldfishSimulation({
      deckSize,
      lands,
      curve: flatCurve(deckSize - lands, 4),
      onPlay: false,
      maxTurn: 6,
      trials: 4000,
      seed: 3,
    });
    for (const turn of result) {
      expect(turn.averageWastedMana).toBeGreaterThanOrEqual(0);
      expect(turn.legalPlayProbability).toBeGreaterThanOrEqual(0);
      expect(turn.legalPlayProbability).toBeLessThanOrEqual(1);
    }
  });
});
