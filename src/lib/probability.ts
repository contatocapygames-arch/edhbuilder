/**
 * Núcleo matemático: distribuição hipergeométrica exata para simular
 * "compras sem reposição" de um deck de Magic, e utilitários derivados
 * (cobertura de múltiplos grupos via inclusão-exclusão).
 *
 * Referências do modelo:
 * - Frank Karsten, "How Many Sources Do You Need to Consistently Cast Your
 *   Spells?" (ChannelFireball) — usa a hipergeométrica para calcular fontes
 *   de mana necessárias por turno com ~90% de consistência.
 * - Draftsim / AetherHub / Deck-u-lator — calculadoras públicas que usam a
 *   hipergeométrica (univariada) e a multivariada para probabilidade de
 *   comprar combinações de cartas.
 */

/** log-gamma (Lanczos) para calcular combinações grandes sem overflow. */
function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** P(X = k) para X ~ Hipergeométrica(N cartas, K sucessos, n compradas). */
export function hypergeomPMF(N: number, K: number, n: number, k: number): number {
  if (k < 0 || k > K || k > n || n - k > N - K) return 0;
  if (N <= 0 || n < 0 || n > N) return 0;
  const logP = logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n);
  return Math.exp(logP);
}

/** P(X >= k). */
export function hypergeomAtLeast(N: number, K: number, n: number, k: number): number {
  if (k <= 0) return 1;
  const kMax = Math.min(K, n);
  if (k > kMax) return 0;
  // Soma pela cauda menor para estabilidade/performance.
  const kMin = Math.max(0, n - (N - K));
  let sum = 0;
  if (k - kMin <= kMax - k) {
    for (let i = kMin; i < k; i++) sum += hypergeomPMF(N, K, n, i);
    return clamp01(1 - sum);
  }
  for (let i = k; i <= kMax; i++) sum += hypergeomPMF(N, K, n, i);
  return clamp01(sum);
}

/** P(X <= k). */
export function hypergeomAtMost(N: number, K: number, n: number, k: number): number {
  return clamp01(1 - hypergeomAtLeast(N, K, n, k + 1));
}

export function hypergeomMean(N: number, K: number, n: number): number {
  return (n * K) / N;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Quantas cartas o jogador já viu (mão + compras) até o início/final do
 * turno `turn`, no modelo padrão das calculadoras de MTG:
 * - Jogando primeiro ("on the play"): sem compra no turno 1.
 * - Jogando depois ("on the draw"): compra também no turno 1.
 */
export function cardsSeenByTurn(
  turn: number,
  onPlay: boolean,
  startingHandSize = 7,
  extraDrawsPerTurn = 0
): number {
  if (turn <= 0) return startingHandSize;
  const draws = onPlay ? turn - 1 : turn;
  return startingHandSize + draws * (1 + extraDrawsPerTurn);
}

export interface GroupSpec {
  id: string;
  label: string;
  /** número de "sucessos" no baralho para este grupo (cópias + tutores dedicados). */
  successes: number;
}

/**
 * P(a mão/compras contém pelo menos 1 sucesso de CADA grupo), assumindo
 * grupos disjuntos (nenhuma carta pertence a dois grupos). Exato via
 * inclusão-exclusão sobre os eventos "grupo i não apareceu nenhuma vez".
 *
 * Não é válido para tutores "wildcard" que podem satisfazer qualquer grupo
 * (nesse caso um único tutor não pode contar como sucesso simultâneo em
 * dois grupos) — para isso, use a simulação Monte Carlo em simulation.ts.
 */
export function probabilityAllGroupsCovered(
  deckSize: number,
  groups: number[],
  cardsSeen: number
): number {
  const m = groups.length;
  if (m === 0) return 1;
  if (m > 20) {
    throw new Error("Muitos grupos para inclusão-exclusão exata (máx. 20).");
  }
  let result = 0;
  const totalSubsets = 1 << m;
  for (let mask = 0; mask < totalSubsets; mask++) {
    let sumK = 0;
    let bits = 0;
    for (let i = 0; i < m; i++) {
      if (mask & (1 << i)) {
        sumK += groups[i];
        bits++;
      }
    }
    // P(nenhuma carta dos grupos em `mask` foi comprada)
    const pMiss = hypergeomAtMost(deckSize, sumK, cardsSeen, 0);
    result += (bits % 2 === 0 ? 1 : -1) * pMiss;
  }
  return clamp01(result);
}

/** P(pelo menos 1 sucesso de um único grupo — caso mais comum: "peça OU redundância OU tutor dedicado"). */
export function probabilityAtLeastOneOfGroup(
  deckSize: number,
  groupSuccesses: number,
  cardsSeen: number
): number {
  return hypergeomAtLeast(deckSize, groupSuccesses, cardsSeen, 1);
}

/**
 * Probabilidade de ter jogado terrenos "on curve": pelo menos `turn`
 * terrenos entre as cartas vistas até o turno `turn`.
 */
export function landDropProbability(
  deckSize: number,
  totalLands: number,
  turn: number,
  onPlay: boolean
): number {
  const seen = cardsSeenByTurn(turn, onPlay);
  return hypergeomAtLeast(deckSize, totalLands, seen, turn);
}

/**
 * Probabilidade de ter, entre as cartas vistas até o turno `turn`, pelo
 * menos `pips` fontes da cor pedida (modelo de Karsten para "conseguir
 * pagar o custo colorido na curva").
 */
export function colorSourceProbability(
  deckSize: number,
  colorSources: number,
  pips: number,
  turn: number,
  onPlay: boolean
): number {
  const seen = cardsSeenByTurn(turn, onPlay);
  return hypergeomAtLeast(deckSize, colorSources, seen, pips);
}

/**
 * Heurística de referência (não é uma garantia matemática) para "quantos
 * terrenos" num deck de Commander (99 cartas + comandante), baseada nas
 * faixas de CMV médio divulgadas publicamente por Frank Karsten a partir
 * de simulações Monte Carlo. Sempre exibir junto das probabilidades EXATAS
 * calculadas por hipergeométrica, que são a fonte de verdade.
 */
export function karstenLandBandForCommander(avgNonlandCMC: number): {
  min: number;
  max: number;
  note: string;
} {
  if (avgNonlandCMC <= 2.1) {
    return { min: 19, max: 22, note: "curva baixa (deck agressivo/combo rápido)" };
  }
  if (avgNonlandCMC <= 3.3) {
    return { min: 23, max: 26, note: "curva média (midrange/valor)" };
  }
  return { min: 27, max: 30, note: "curva alta (controle/battlecruiser)" };
}
