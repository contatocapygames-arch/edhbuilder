import { describe, expect, it } from "vitest";
import { detectImportUrl, parseArchidektDeck, parseMoxfieldDeck } from "../deckImport";
import { parseDecklist } from "../deckParser";

describe("detectImportUrl", () => {
  it("recognizes Moxfield deck links", () => {
    expect(detectImportUrl("https://www.moxfield.com/decks/abc123XYZ")).toEqual({
      platform: "moxfield",
      id: "abc123XYZ",
    });
    expect(detectImportUrl("moxfield.com/decks/abc123XYZ?utm=x")).toEqual({
      platform: "moxfield",
      id: "abc123XYZ",
    });
  });

  it("recognizes Archidekt deck links", () => {
    expect(detectImportUrl("https://archidekt.com/decks/365563/my_deck")).toEqual({
      platform: "archidekt",
      id: "365563",
    });
  });

  it("returns null for unrecognized links", () => {
    expect(detectImportUrl("https://example.com/decks/123")).toBeNull();
    expect(detectImportUrl("not a url")).toBeNull();
  });
});

describe("parseMoxfieldDeck", () => {
  it("builds a decklist with a Commander section and merges mainboard+companions", () => {
    const text = parseMoxfieldDeck({
      name: "Kinnan combo",
      boards: {
        commanders: { cards: { a: { quantity: 1, card: { name: "Kinnan, Bonder Prodigy" } } } },
        mainboard: {
          cards: {
            b: { quantity: 1, card: { name: "Sol Ring" } },
            c: { quantity: 1, card: { name: "Basalt Monolith" } },
          },
        },
        companions: { cards: { d: { quantity: 1, card: { name: "Lurrus of the Dream-Den" } } } },
      },
    });
    const parsed = parseDecklist(text);
    expect(parsed.find((c) => c.name === "Kinnan, Bonder Prodigy")?.isCommander).toBe(true);
    expect(parsed.find((c) => c.name === "Sol Ring")).toBeTruthy();
    expect(parsed.find((c) => c.name === "Basalt Monolith")).toBeTruthy();
    expect(parsed.find((c) => c.name === "Lurrus of the Dream-Den")?.isCommander).toBe(false);
  });

  it("throws a clear error when the mainboard is missing", () => {
    expect(() => parseMoxfieldDeck({ boards: {} })).toThrow(/mainboard/i);
  });
});

describe("parseArchidektDeck", () => {
  it("builds a decklist, tags the Commander, and drops maybeboard/sideboard cards", () => {
    const text = parseArchidektDeck({
      name: "Test deck",
      cards: [
        { quantity: 1, categories: ["Commander"], card: { oracleCard: { name: "Atraxa" } } },
        { quantity: 1, categories: [], card: { oracleCard: { name: "Sol Ring" } } },
        { quantity: 2, categories: ["Maybeboard"], card: { oracleCard: { name: "Some Cut Card" } } },
      ],
    });
    const parsed = parseDecklist(text);
    expect(parsed.find((c) => c.name === "Atraxa")?.isCommander).toBe(true);
    expect(parsed.find((c) => c.name === "Sol Ring")?.isCommander).toBe(false);
    expect(parsed.find((c) => c.name === "Some Cut Card")).toBeUndefined();
  });

  it("throws when there are no cards", () => {
    expect(() => parseArchidektDeck({ cards: [] })).toThrow();
  });
});
