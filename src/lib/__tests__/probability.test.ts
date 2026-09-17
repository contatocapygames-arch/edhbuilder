import { describe, expect, it } from "vitest";
import {
  cardsSeenByTurn,
  hypergeomAtLeast,
  hypergeomAtMost,
  hypergeomPMF,
  probabilityAllGroupsCovered,
} from "../probability";

function factorial(n: number): bigint {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
}

function chooseExact(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  return factorial(n) / (factorial(k) * factorial(n - k));
}

/** Referência exata independente (BigInt) para validar logGamma/logChoose. */
function hypergeomExactRef(N: number, K: number, n: number, k: number): number {
  const num = Number(chooseExact(K, k)) * Number(chooseExact(N - K, n - k));
  const den = Number(chooseExact(N, n));
  return num / den;
}

describe("hypergeomPMF", () => {
  it("matches an independent BigInt reference implementation", () => {
    for (const [N, K, n, k] of [
      [10, 3, 4, 1],
      [10, 3, 4, 2],
      [60, 4, 7, 0],
      [60, 4, 7, 1],
      [99, 37, 10, 3],
    ] as const) {
      expect(hypergeomPMF(N, K, n, k)).toBeCloseTo(hypergeomExactRef(N, K, n, k), 9);
    }
  });

  it("sums to 1 across all valid k", () => {
    const N = 40;
    const K = 10;
    const n = 6;
    let sum = 0;
    for (let k = 0; k <= Math.min(K, n); k++) sum += hypergeomPMF(N, K, n, k);
    expect(sum).toBeCloseTo(1, 9);
  });
});

describe("hypergeomAtLeast", () => {
  it("matches the well-known ~11.7% chance of a single copy in an opening 7 of 60", () => {
    expect(hypergeomAtLeast(60, 1, 7, 1)).toBeCloseTo(7 / 60, 6);
    expect(hypergeomAtLeast(60, 1, 7, 1)).toBeCloseTo(0.1167, 3);
  });

  it("matches the well-known ~39.9% chance of seeing at least one of a 4-of in the opening hand", () => {
    const p = hypergeomAtLeast(60, 4, 7, 1);
    expect(p).toBeCloseTo(0.399, 2);
  });

  it("is complementary to hypergeomAtMost", () => {
    const N = 99, K = 37, n = 9;
    for (let k = 0; k <= 5; k++) {
      expect(hypergeomAtLeast(N, K, n, k) + hypergeomAtMost(N, K, n, k - 1)).toBeCloseTo(1, 9);
    }
  });

  it("returns 1 for k<=0 and 0 for impossible k", () => {
    expect(hypergeomAtLeast(60, 4, 7, 0)).toBe(1);
    expect(hypergeomAtLeast(60, 4, 7, 5)).toBe(0);
  });
});

describe("cardsSeenByTurn", () => {
  it("does not draw on turn 1 on the play", () => {
    expect(cardsSeenByTurn(1, true)).toBe(7);
    expect(cardsSeenByTurn(2, true)).toBe(8);
    expect(cardsSeenByTurn(3, true)).toBe(9);
  });

  it("draws on turn 1 on the draw", () => {
    expect(cardsSeenByTurn(1, false)).toBe(8);
    expect(cardsSeenByTurn(2, false)).toBe(9);
  });
});

describe("probabilityAllGroupsCovered", () => {
  it("matches brute-force enumeration for small disjoint groups", () => {
    const N = 10;
    const n = 5;
    const groupSizes = [2, 2]; // cartas 0,1 = grupo A; 2,3 = grupo B; 4..9 = resto
    const groupAIdx = [0, 1];
    const groupBIdx = [2, 3];

    const indices = Array.from({ length: N }, (_, i) => i);
    function combinations(arr: number[], k: number): number[][] {
      if (k === 0) return [[]];
      if (arr.length < k) return [];
      const [first, ...rest] = arr;
      const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
      const withoutFirst = combinations(rest, k);
      return [...withFirst, ...withoutFirst];
    }
    const allHands = combinations(indices, n);
    const covered = allHands.filter(
      (hand) =>
        groupAIdx.some((i) => hand.includes(i)) && groupBIdx.some((i) => hand.includes(i))
    );
    const bruteForce = covered.length / allHands.length;

    expect(probabilityAllGroupsCovered(N, groupSizes, n)).toBeCloseTo(bruteForce, 9);
  });

  it("equals plain hypergeomAtLeast for a single group", () => {
    const N = 99, K = 8, n = 10;
    const viaInclusionExclusion = probabilityAllGroupsCovered(N, [K], n);
    expect(viaInclusionExclusion).toBeCloseTo(hypergeomAtLeast(N, K, n, 1), 9);
  });

  it("returns 1 for zero groups", () => {
    expect(probabilityAllGroupsCovered(99, [], 10)).toBe(1);
  });
});
