import { describe, expect, it } from "vitest";
import { classifyCard } from "../classify";
import type { ScryfallCard } from "../scryfall";

function card(overrides: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: overrides.name.toLowerCase(),
    mana_cost: "{1}",
    cmc: 1,
    type_line: "Enchantment",
    oracle_text: "",
    colors: [],
    color_identity: [],
    produced_mana: [],
    keywords: [],
    layout: "normal",
    ...overrides,
  };
}

describe("classifyCard draw detection", () => {
  it("flags Rhystic Study as a repeatable (engine) draw effect that draws 1 card", () => {
    const c = classifyCard(
      card({
        name: "Rhystic Study",
        oracle_text: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
      }),
      1,
      false
    );
    expect(c.isDraw).toBe(true);
    expect(c.drawAmount).toBe(1);
    expect(c.isRepeatableDraw).toBe(true);
  });

  it("flags Mystic Remora as repeatable", () => {
    const c = classifyCard(
      card({
        name: "Mystic Remora",
        oracle_text:
          "Whenever an opponent casts their second spell each turn, you may draw a card unless that player pays {4}.",
      }),
      1,
      false
    );
    expect(c.isRepeatableDraw).toBe(true);
  });

  it("flags Phyrexian Arena as a repeatable draw-1 engine", () => {
    const c = classifyCard(
      card({
        name: "Phyrexian Arena",
        oracle_text: "At the beginning of your upkeep, you lose 1 life and draw a card.",
      }),
      1,
      false
    );
    expect(c.isRepeatableDraw).toBe(true);
    expect(c.drawAmount).toBe(1);
  });

  it("parses 'draw two additional cards' (Sylvan Library) as an engine drawing 2", () => {
    const c = classifyCard(
      card({
        name: "Sylvan Library",
        oracle_text: "At the beginning of your draw step, draw two additional cards.",
      }),
      1,
      false
    );
    expect(c.isDraw).toBe(true);
    expect(c.drawAmount).toBe(2);
    expect(c.isRepeatableDraw).toBe(true);
  });

  it("treats Harmonize (draw three cards) as a one-shot burst, not repeatable", () => {
    const c = classifyCard(
      card({ name: "Harmonize", oracle_text: "Draw three cards." }),
      1,
      false
    );
    expect(c.isDraw).toBe(true);
    expect(c.drawAmount).toBe(3);
    expect(c.isRepeatableDraw).toBe(false);
  });

  it("defaults to 0/false for cards with no draw effect", () => {
    const c = classifyCard(card({ name: "Sol Ring", oracle_text: "{T}: Add {C}{C}." }), 1, false);
    expect(c.isDraw).toBe(false);
    expect(c.drawAmount).toBe(0);
    expect(c.isRepeatableDraw).toBe(false);
  });
});

describe("classifyCard mana production", () => {
  it("parses Sol Ring as ramp producing 2 mana per activation", () => {
    const c = classifyCard(
      card({ name: "Sol Ring", type_line: "Artifact", oracle_text: "{T}: Add {C}{C}." }),
      1,
      false
    );
    expect(c.isRamp).toBe(true);
    expect(c.manaProduced).toBe(2);
  });

  it("parses Arcane Signet as ramp producing 1 mana per activation", () => {
    const c = classifyCard(
      card({
        name: "Arcane Signet",
        type_line: "Artifact",
        oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
        produced_mana: ["W", "U", "B", "R", "G"],
      }),
      1,
      false
    );
    expect(c.isRamp).toBe(true);
    expect(c.manaProduced).toBe(1);
  });

  it("parses Mana Vault as ramp producing 3 mana per activation", () => {
    const c = classifyCard(
      card({ name: "Mana Vault", type_line: "Artifact", oracle_text: "{T}: Add {C}{C}{C}." }),
      1,
      false
    );
    expect(c.manaProduced).toBe(3);
  });

  it("does not assign manaProduced to non-ramp cards", () => {
    const c = classifyCard(
      card({ name: "Demonic Tutor", oracle_text: "Search your library for a card and put that card into your hand." }),
      1,
      false
    );
    expect(c.isRamp).toBe(false);
    expect(c.manaProduced).toBe(0);
  });
});

describe("classifyCard ritual detection", () => {
  it("flags Dark Ritual as a one-shot ritual (instant/sorcery ramp), not a permanent source", () => {
    const c = classifyCard(
      card({ name: "Dark Ritual", type_line: "Instant", oracle_text: "Add {B}{B}{B}." }),
      1,
      false
    );
    expect(c.isRamp).toBe(true);
    expect(c.manaProduced).toBe(3);
    expect(c.isRitual).toBe(true);
  });

  it("flags Seething Song (sorcery) as a ritual too", () => {
    const c = classifyCard(
      card({
        name: "Seething Song",
        type_line: "Sorcery",
        oracle_text: "Add {R}{R}{R}{R}{R}.",
      }),
      1,
      false
    );
    expect(c.isRitual).toBe(true);
  });

  it("does not flag permanent ramp (Sol Ring, an artifact) as a ritual", () => {
    const c = classifyCard(
      card({ name: "Sol Ring", type_line: "Artifact", oracle_text: "{T}: Add {C}{C}." }),
      1,
      false
    );
    expect(c.isRamp).toBe(true);
    expect(c.isRitual).toBe(false);
  });

  it("does not flag non-ramp cards as rituals", () => {
    const c = classifyCard(
      card({ name: "Demonic Tutor", oracle_text: "Search your library for a card and put that card into your hand." }),
      1,
      false
    );
    expect(c.isRitual).toBe(false);
  });
});
