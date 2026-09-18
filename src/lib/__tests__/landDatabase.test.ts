import { describe, expect, it } from "vitest";
import { LAND_DATABASE, suggestLands } from "../landDatabase";

describe("LAND_DATABASE", () => {
  it("does not include any triome (excluded on purpose)", () => {
    expect(LAND_DATABASE.some((l) => l.cycle === ("triome" as string))).toBe(false);
    expect(LAND_DATABASE.some((l) => l.name.toLowerCase().includes("triome"))).toBe(false);
  });

  it("every cycle land other than Path of Ancestry enters untapped", () => {
    const tapped = LAND_DATABASE.filter((l) => l.entersTapped).map((l) => l.name);
    expect(tapped).toEqual(["Path of Ancestry"]);
  });
});

describe("suggestLands", () => {
  it("only suggests fetch/shock/pain lands whose colors are a subset of the identity", () => {
    const result = suggestLands(["U", "B"], new Set());
    for (const land of result.filter((l) => l.colors.length > 0)) {
      for (const c of land.colors) expect(["U", "B"]).toContain(c);
    }
    expect(result.some((l) => l.name === "Watery Grave")).toBe(true); // U/B shock
    expect(result.some((l) => l.name === "Blood Crypt")).toBe(false); // B/R, R not in identity
  });

  it("excludes lands already owned (case-insensitive)", () => {
    const withoutOwned = suggestLands(["U", "B"], new Set());
    expect(withoutOwned.some((l) => l.name === "Watery Grave")).toBe(true);
    const withOwned = suggestLands(["U", "B"], new Set(["watery grave"]));
    expect(withOwned.some((l) => l.name === "Watery Grave")).toBe(false);
  });

  it("always includes any-color lands regardless of identity", () => {
    const mono = suggestLands(["R"], new Set());
    expect(mono.some((l) => l.name === "Command Tower")).toBe(true);
  });

  it("sorts lands that enter tapped after untapped ones (deprioritized, not excluded)", () => {
    const result = suggestLands(["W", "U", "B", "R", "G"], new Set());
    const pathIdx = result.findIndex((l) => l.name === "Path of Ancestry");
    expect(pathIdx).toBeGreaterThan(-1);
    expect(pathIdx).toBe(result.length - 1);
    expect(result.every((l, i) => i >= pathIdx || !l.entersTapped)).toBe(true);
  });

  it("never suggests a single-color land from a cycle (all cycle lands are 2-color)", () => {
    const result = suggestLands(["G"], new Set());
    expect(result.every((l) => l.colors.length === 0 || l.colors.length >= 2)).toBe(true);
  });
});
