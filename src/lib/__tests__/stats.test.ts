import { describe, expect, it } from "vitest";
import type { ClassifiedCard, ManaColor } from "../classify";
import { computeDeckStats } from "../stats";

function card(overrides: Partial<ClassifiedCard> & { name: string; quantity: number }): ClassifiedCard {
  return {
    isCommander: false,
    cmc: 0,
    typeLine: "",
    manaCost: "",
    colorIdentity: [] as ManaColor[],
    oracleText: "",
    keywords: [],
    isLand: false,
    producesColors: [] as ManaColor[],
    isManaSource: false,
    isRamp: false,
    manaProduced: 0,
    isRitual: false,
    isTutor: false,
    tutorTargetsAny: false,
    tutorTargetHint: null,
    tutorSpeed: null,
    isDraw: false,
    drawAmount: 0,
    isRepeatableDraw: false,
    isRemoval: false,
    pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    ...overrides,
  };
}

function buildDeck(landCount: number, blueSourceCount: number, nonlandCount: number): ClassifiedCard[] {
  const cards: ClassifiedCard[] = [];
  cards.push(
    card({
      name: "Island",
      quantity: blueSourceCount,
      isLand: true,
      typeLine: "Basic Land — Island",
      producesColors: ["U"],
    })
  );
  if (landCount > blueSourceCount) {
    cards.push(
      card({ name: "Wastes", quantity: landCount - blueSourceCount, isLand: true, producesColors: ["C"] })
    );
  }
  cards.push(
    card({
      name: "Blue Spell",
      quantity: nonlandCount,
      cmc: 2,
      manaCost: "{1}{U}",
      pips: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
    })
  );
  return cards;
}

describe("computeDeckStats", () => {
  it("computes flood/screw probabilities that are complementary and sane", () => {
    const librarySize = 99;
    const cards = buildDeck(37, 37, librarySize - 37);
    const stats = computeDeckStats(cards, librarySize, { onPlay: true, maxTurn: 40 });

    for (let i = 0; i < stats.landDropByTurn.length; i++) {
      expect(stats.landDropByTurn[i].probability + stats.screwProbabilityByTurn[i].probability).toBeCloseTo(
        1,
        9
      );
    }
    // Flood (muitos terrenos a mais) deve ser bem menos provável que "on curve" no início.
    expect(stats.floodProbabilityByTurn[0].probability).toBeLessThan(stats.landDropByTurn[0].probability);
    // Fica impossível (0) quando turno + excedente supera o total de terrenos do deck.
    const impossibleTurn = stats.floodProbabilityByTurn.find((p) => p.turn + 3 > 37);
    expect(impossibleTurn?.probability).toBe(0);
  });

  it("gives a well-built deck (lands in its Karsten band, good color sources) a higher consistency score than a bad one", () => {
    const librarySize = 99;
    // CMV médio 2 (curva baixa) -> banda de Karsten recomendada é 19-22 terrenos.
    const good = computeDeckStats(buildDeck(20, 20, librarySize - 20), librarySize, {
      onPlay: true,
      maxTurn: 10,
    });
    const bad = computeDeckStats(buildDeck(10, 3, librarySize - 10), librarySize, {
      onPlay: true,
      maxTurn: 10,
    });

    expect(good.karstenBand).toEqual({ min: 19, max: 22, note: "curva baixa (deck agressivo/combo rápido)" });
    expect(good.consistencyScore.overall).toBeGreaterThan(bad.consistencyScore.overall);
    expect(good.consistencyScore.overall).toBeLessThanOrEqual(100);
    expect(bad.consistencyScore.overall).toBeGreaterThanOrEqual(0);

    const weightSum = good.consistencyScore.breakdown.reduce((s, b) => s + b.weight, 0);
    expect(weightSum).toBeCloseTo(1, 9);
  });
});
