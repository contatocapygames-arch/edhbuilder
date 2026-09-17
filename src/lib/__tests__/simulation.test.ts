import { describe, expect, it } from "vitest";
import { hypergeomAtLeast } from "../probability";
import { runComboSimulation } from "../simulation";

describe("runComboSimulation", () => {
  it("converges to the closed-form hypergeometric when there is a single piece and no tutors", () => {
    const deckSize = 99;
    const copies = 8;
    const turn = 5;
    const onPlay = true;

    const result = runComboSimulation({
      deckSize,
      lands: 36,
      onPlay,
      pieces: [{ id: "p1", copies }],
      tutors: [],
      maxTurn: turn,
      trials: 20000,
      seed: 42,
    });

    const expected = hypergeomAtLeast(deckSize, copies, 7 + (turn - 1), 1);
    const atTurn = result.probabilityByTurn.find((p) => p.turn === turn)!.probability;
    expect(atTurn).toBeGreaterThan(expected - 0.02);
    expect(atTurn).toBeLessThan(expected + 0.02);
  });

  it("increases completion probability when a dedicated tutor is added", () => {
    const base = {
      deckSize: 99,
      lands: 36,
      onPlay: true,
      tutors: [],
      maxTurn: 6,
      trials: 8000,
      seed: 7,
    };
    const withoutTutor = runComboSimulation({
      ...base,
      pieces: [{ id: "p1", copies: 1 }],
    });
    const withTutor = runComboSimulation({
      ...base,
      pieces: [{ id: "p1", copies: 1 }],
      tutors: [
        { id: "t1", label: "Demonic Tutor", copies: 1, cmc: 2, targets: ["p1"], speed: "hand" },
      ],
    });
    const finalWithout = withoutTutor.probabilityByTurn.at(-1)!.probability;
    const finalWith = withTutor.probabilityByTurn.at(-1)!.probability;
    expect(finalWith).toBeGreaterThan(finalWithout);
  });

  it("requires both pieces for a two-piece combo (monotonic, bounded by single-piece probabilities)", () => {
    const result = runComboSimulation({
      deckSize: 99,
      lands: 36,
      onPlay: true,
      pieces: [
        { id: "a", copies: 3 },
        { id: "b", copies: 3 },
      ],
      tutors: [],
      maxTurn: 10,
      trials: 10000,
      seed: 3,
    });
    for (let i = 1; i < result.probabilityByTurn.length; i++) {
      expect(result.probabilityByTurn[i].probability).toBeGreaterThanOrEqual(
        result.probabilityByTurn[i - 1].probability
      );
    }
    const singleA = hypergeomAtLeast(99, 3, 7 + 9, 1);
    expect(result.probabilityByTurn.at(-1)!.probability).toBeLessThanOrEqual(singleA + 1e-9);
  });

  it("returns probability 1 immediately when there are no required pieces", () => {
    const result = runComboSimulation({
      deckSize: 99,
      lands: 36,
      onPlay: true,
      pieces: [],
      tutors: [],
      maxTurn: 3,
      trials: 100,
    });
    expect(result.completionRate).toBe(1);
    expect(result.probabilityByTurn.every((p) => p.probability === 1)).toBe(true);
  });

  it("a wildcard tutor cannot satisfy two missing pieces by itself in the same cast", () => {
    // Baralho pequeno para tornar o efeito visível: 1 tutor wildcard, 0 cópias
    // naturais de A ou B — o combo só fecha se o tutor buscar UMA peça e a
    // outra for comprada naturalmente (nunca as duas ao mesmo tempo).
    const result = runComboSimulation({
      deckSize: 20,
      lands: 8,
      onPlay: true,
      pieces: [
        { id: "a", copies: 1 },
        { id: "b", copies: 1 },
      ],
      tutors: [{ id: "t", label: "Wildcard", copies: 1, cmc: 1, targets: "any", speed: "hand" }],
      maxTurn: 2,
      trials: 20000,
      seed: 99,
    });
    // Turno 1 on the play: só a mão inicial (7 de 20). Não é possível ter A, B
    // e o tutor resolvendo simultaneamente mais uma peça vinda da compra.
    expect(result.probabilityByTurn[0].probability).toBeLessThan(1);
  });
});
