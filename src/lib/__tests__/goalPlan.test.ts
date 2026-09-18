import { describe, expect, it } from "vitest";
import { hypergeomAtLeast, cardsSeenByTurn } from "../probability";
import { runGoalPlanSimulation, type GoalPlanConfig, type GoalMilestone } from "../goalPlan";

const emptyCategories: GoalPlanConfig["categoryCards"] = { ramp: [], tutor: [], draw: [], removal: [] };

function landsOf(count: number, colors: ("W" | "U" | "B" | "R" | "G" | "C")[]) {
  return Array.from({ length: count }, () => ({ producesColors: colors }));
}

describe("runGoalPlanSimulation", () => {
  it("a single landCount milestone converges to the closed-form hypergeometric", () => {
    const deckSize = 99;
    const landCount = 37;
    const turn = 4;
    const milestones: GoalMilestone[] = [{ id: "m1", kind: "landCount", turn, minLands: turn }];
    const result = runGoalPlanSimulation({
      deckSize,
      lands: landsOf(landCount, ["U"]),
      onPlay: true,
      milestones,
      categoryCards: emptyCategories,
      trials: 20000,
      seed: 1,
    });
    const expected = hypergeomAtLeast(deckSize, landCount, cardsSeenByTurn(turn, true), turn);
    expect(result.overallProbability).toBeGreaterThan(expected - 0.02);
    expect(result.overallProbability).toBeLessThan(expected + 0.02);
  });

  it("a single colorSources milestone converges to the closed-form hypergeometric", () => {
    const deckSize = 60;
    const blueSources = 15;
    const turn = 3;
    const milestones: GoalMilestone[] = [
      { id: "m1", kind: "colorSources", turn, color: "U", minSources: 1 },
    ];
    const result = runGoalPlanSimulation({
      deckSize,
      lands: landsOf(blueSources, ["U"]),
      onPlay: true,
      milestones,
      categoryCards: emptyCategories,
      trials: 20000,
      seed: 2,
    });
    const expected = hypergeomAtLeast(deckSize, blueSources, cardsSeenByTurn(turn, true), 1);
    expect(result.overallProbability).toBeGreaterThan(expected - 0.02);
    expect(result.overallProbability).toBeLessThan(expected + 0.02);
  });

  it("models 'commander turn 1' as mana availability only (no draw needed — it's in the command zone)", () => {
    const deckSize = 99;
    const milestones: GoalMilestone[] = [
      { id: "cmdr", kind: "castCard", turn: 1, target: { type: "commander" } },
    ];
    const result = runGoalPlanSimulation({
      deckSize,
      lands: landsOf(40, ["U"]),
      onPlay: true,
      commander: { cmc: 1, pips: { U: 1 } },
      milestones,
      categoryCards: emptyCategories,
      trials: 20000,
      seed: 3,
    });
    // Turno 1 on the play: precisa só de 1 terreno azul na mão inicial de 7,
    // já que o comandante sai da zona de comando (não precisa ser comprado).
    const expected = hypergeomAtLeast(deckSize, 40, 7, 1);
    expect(result.overallProbability).toBeGreaterThan(expected - 0.02);
    expect(result.overallProbability).toBeLessThan(expected + 0.02);
  });

  it("a compound plan (commander turn 1 AND 4 mana turn 2) is never more likely than either goal alone", () => {
    const base = {
      deckSize: 99,
      lands: landsOf(38, ["U"]),
      onPlay: true,
      commander: { cmc: 1, pips: { U: 1 } as Record<string, number> },
      categoryCards: emptyCategories,
      trials: 15000,
      seed: 4,
    };
    const commanderOnly = runGoalPlanSimulation({
      ...base,
      milestones: [{ id: "cmdr", kind: "castCard", turn: 1, target: { type: "commander" } }],
    });
    const manaOnly = runGoalPlanSimulation({
      ...base,
      milestones: [{ id: "mana2", kind: "landCount", turn: 2, minLands: 4 }],
    });
    const both = runGoalPlanSimulation({
      ...base,
      milestones: [
        { id: "cmdr", kind: "castCard", turn: 1, target: { type: "commander" } },
        { id: "mana2", kind: "landCount", turn: 2, minLands: 4 },
      ],
    });
    expect(both.overallProbability).toBeLessThanOrEqual(commanderOnly.overallProbability + 1e-9);
    expect(both.overallProbability).toBeLessThanOrEqual(manaOnly.overallProbability + 1e-9);
    // 4 terrenos até o turno 2 é impossível de qualquer forma (só 1-2 land drops feitos)
    expect(manaOnly.overallProbability).toBe(0);
    expect(both.overallProbability).toBe(0);
  });

  it("a castCount milestone counts repeated casts of a category (e.g. ramp) toward the goal", () => {
    const deckSize = 60;
    const milestones: GoalMilestone[] = [
      {
        id: "ramp2",
        kind: "castCount",
        byTurn: 4,
        target: { type: "category", category: "ramp", label: "Rampa" },
        minCount: 2,
      },
    ];
    const fewRamp = runGoalPlanSimulation({
      deckSize,
      lands: landsOf(24, ["C"]),
      onPlay: true,
      milestones,
      categoryCards: {
        ...emptyCategories,
        ramp: [{ requirement: { cmc: 1, pips: {} }, copies: 2 }],
      },
      trials: 10000,
      seed: 5,
    });
    const manyRamp = runGoalPlanSimulation({
      deckSize,
      lands: landsOf(24, ["C"]),
      onPlay: true,
      milestones,
      categoryCards: {
        ...emptyCategories,
        ramp: [{ requirement: { cmc: 1, pips: {} }, copies: 10 }],
      },
      trials: 10000,
      seed: 5,
    });
    expect(manyRamp.overallProbability).toBeGreaterThan(fewRamp.overallProbability);
  });

  it("throws a clear error when targets + lands exceed the deck size", () => {
    expect(() =>
      runGoalPlanSimulation({
        deckSize: 20,
        lands: landsOf(15, ["U"]),
        onPlay: true,
        milestones: [
          {
            id: "c1",
            kind: "castCard",
            turn: 1,
            target: { type: "card", id: "x", label: "X", copies: 10, requirement: { cmc: 1, pips: {} } },
          },
        ],
        categoryCards: emptyCategories,
        trials: 10,
      })
    ).toThrow();
  });

  it("returns overallProbability 1 with no milestones", () => {
    const result = runGoalPlanSimulation({
      deckSize: 99,
      lands: landsOf(37, ["U"]),
      onPlay: true,
      milestones: [],
      categoryCards: emptyCategories,
      trials: 100,
    });
    expect(result.overallProbability).toBe(1);
    expect(result.perMilestone).toEqual([]);
  });

  it("a castCard 'CMV específico' milestone checks for ANY card of that mana value, not a named one", () => {
    const deckSize = 99;
    const turn = 4;
    const milestones: GoalMilestone[] = [
      { id: "cmc3", kind: "castCard", turn, target: { type: "cmc", cmc: 3, label: "CMV 3" } },
    ];
    // 8 cartas distintas de CMV 3 no baralho (tratadas como um "pool" fungível).
    const result = runGoalPlanSimulation({
      deckSize,
      lands: landsOf(37, ["U"]),
      onPlay: true,
      milestones,
      categoryCards: emptyCategories,
      cmcCards: { 3: [{ requirement: { cmc: 3, pips: {} }, copies: 8 }] },
      trials: 15000,
      seed: 6,
    });
    // Precisa achar 1 de 8 "CMV 3" na mão/compras E ter 3 terrenos — deve
    // ser bem menor que só a chance de terrenos (não é garantido achar uma).
    const landsOnly = hypergeomAtLeast(deckSize, 37, cardsSeenByTurn(turn, true), 3);
    expect(result.overallProbability).toBeGreaterThan(0);
    expect(result.overallProbability).toBeLessThan(landsOnly);
  });

  it("a castCount 'CMV específico' milestone counts repeated casts of any card sharing that CMV", () => {
    const base = {
      deckSize: 60,
      lands: landsOf(24, ["C"]),
      onPlay: true,
      categoryCards: emptyCategories,
      trials: 10000,
      seed: 7,
    };
    const milestones: GoalMilestone[] = [
      {
        id: "cmc1x2",
        kind: "castCount",
        byTurn: 4,
        target: { type: "cmc", cmc: 1, label: "CMV 1" },
        minCount: 2,
      },
    ];
    const fewOptions = runGoalPlanSimulation({
      ...base,
      milestones,
      cmcCards: { 1: [{ requirement: { cmc: 1, pips: {} }, copies: 3 }] },
    });
    const manyOptions = runGoalPlanSimulation({
      ...base,
      milestones,
      cmcCards: { 1: [{ requirement: { cmc: 1, pips: {} }, copies: 15 }] },
    });
    expect(manyOptions.overallProbability).toBeGreaterThan(fewOptions.overallProbability);
  });

  it("manaAvailable counts lands only, matching landCount exactly, when there's no ramp", () => {
    const deckSize = 99;
    const landCount = 37;
    const turn = 4;
    const withoutRamp = {
      deckSize,
      lands: landsOf(landCount, ["C"]),
      onPlay: true,
      categoryCards: emptyCategories,
      trials: 15000,
      seed: 8,
    };
    const landResult = runGoalPlanSimulation({
      ...withoutRamp,
      milestones: [{ id: "m1", kind: "landCount", turn, minLands: 4 }],
    });
    const manaResult = runGoalPlanSimulation({
      ...withoutRamp,
      milestones: [{ id: "m1", kind: "manaAvailable", turn, minMana: 4 }],
    });
    expect(manaResult.overallProbability).toBeCloseTo(landResult.overallProbability, 2);
  });

  it("manaAvailable counts mana from ramp already cast (e.g. Sol Ring), unlike landCount", () => {
    const deckSize = 40;
    const turn = 2;
    const base = {
      deckSize,
      lands: landsOf(16, ["C"]),
      onPlay: true,
      categoryCards: {
        ...emptyCategories,
        ramp: [{ requirement: { cmc: 1, pips: {} }, copies: 4, manaProduced: 2 }], // "Sol Ring"
      },
      trials: 15000,
      seed: 9,
    };
    // Turno 2 on the play: no máximo 2 terrenos jogados. "4 mana no turno 2"
    // é impossível só com terrenos, mas possível se um Sol Ring (+2) entrar
    // em jogo no turno 1.
    const landResult = runGoalPlanSimulation({
      ...base,
      milestones: [{ id: "m1", kind: "landCount", turn, minLands: 4 }],
    });
    const manaResult = runGoalPlanSimulation({
      ...base,
      milestones: [{ id: "m1", kind: "manaAvailable", turn, minMana: 4 }],
    });
    expect(landResult.overallProbability).toBe(0);
    expect(manaResult.overallProbability).toBeGreaterThan(0);
  });

  it("ritual mana (e.g. Dark Ritual) counts the turn it's cast but does NOT persist to later turns", () => {
    const deckSize = 40;
    const base = {
      deckSize,
      lands: landsOf(16, ["C"]),
      onPlay: true,
      categoryCards: {
        ...emptyCategories,
        ramp: [
          {
            requirement: { cmc: 1, pips: {} },
            copies: 4,
            manaProduced: 3,
            manaDuration: "oneShot" as const,
          }, // "Dark Ritual"
        ],
      },
      trials: 15000,
      seed: 10,
    };
    // Turno 1 on the play: só 1 terreno jogado. "4 mana no turno 1" só é
    // possível se um ritual (+3) for conjurado no MESMO turno 1.
    const turn1 = runGoalPlanSimulation({
      ...base,
      milestones: [{ id: "m1", kind: "manaAvailable", turn: 1, minMana: 4 }],
    });
    expect(turn1.overallProbability).toBeGreaterThan(0);

    // Turno 2: se o ritual fosse tratado como permanente, sua mana +3
    // continuaria contando e "4 mana no turno 2" (2 terrenos + resquício do
    // ritual) ficaria bem mais fácil do que só com terrenos. Comparando
    // contra uma rampa PERMANENTE equivalente (mesmo manaProduced, sem
    // manaDuration) prova que o ritual não deixa resíduo no turno seguinte.
    const oneShotTurn2 = runGoalPlanSimulation({
      ...base,
      milestones: [{ id: "m1", kind: "manaAvailable", turn: 2, minMana: 4 }],
    });
    const permanentBase = {
      ...base,
      categoryCards: {
        ...emptyCategories,
        ramp: [{ requirement: { cmc: 1, pips: {} }, copies: 4, manaProduced: 3 }], // permanente
      },
    };
    const permanentTurn2 = runGoalPlanSimulation({
      ...permanentBase,
      milestones: [{ id: "m1", kind: "manaAvailable", turn: 2, minMana: 4 }],
    });
    expect(oneShotTurn2.overallProbability).toBeLessThan(permanentTurn2.overallProbability);
  });
});
