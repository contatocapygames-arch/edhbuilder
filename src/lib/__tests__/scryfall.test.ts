import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCardsByName } from "../scryfall";

function makeCard(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    mana_cost: "{1}",
    cmc: 1,
    type_line: "Artifact",
    oracle_text: "",
    colors: [],
    color_identity: [],
    produced_mana: [],
    keywords: [],
    layout: "normal",
    ...overrides,
  };
}

describe("fetchCardsByName", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to /cards/named?fuzzy= for names /cards/collection couldn't match exactly", async () => {
    // "Delver of Secrets" = só a face da frente de uma carta de duas faces;
    // o nome completo/oficial é "Delver of Secrets // Insectile Aberration".
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/cards/collection")) {
        return new Response(
          JSON.stringify({
            data: [makeCard("Sol Ring")],
            not_found: [{ name: "Delver of Secrets" }],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/cards/named") && url.includes("fuzzy=")) {
        return new Response(
          JSON.stringify(
            makeCard("Delver of Secrets // Insectile Aberration", {
              card_faces: [
                { name: "Delver of Secrets", type_line: "Creature — Human Wizard" },
                { name: "Insectile Aberration", type_line: "Creature — Human Insect" },
              ],
            })
          ),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", undefined);

    const result = await fetchCardsByName(["Sol Ring", "Delver of Secrets"]);

    expect(result.notFound).toEqual([]);
    expect(result.fuzzyMatched).toEqual(["Delver of Secrets"]);
    expect(result.found.get("sol ring")?.name).toBe("Sol Ring");
    expect(result.found.get("delver of secrets")?.name).toBe(
      "Delver of Secrets // Insectile Aberration"
    );
  });

  it("keeps a name in notFound when even the fuzzy search fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/cards/collection")) {
        return new Response(
          JSON.stringify({ data: [], not_found: [{ name: "Totally Fake Card Name" }] }),
          { status: 200 }
        );
      }
      if (url.includes("/cards/named")) {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", undefined);

    const result = await fetchCardsByName(["Totally Fake Card Name"]);

    expect(result.notFound).toEqual(["Totally Fake Card Name"]);
    expect(result.fuzzyMatched).toEqual([]);
    expect(result.found.size).toBe(0);
  });
});
