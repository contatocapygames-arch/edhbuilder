import { ALL_COLORS, type ClassifiedCard, type ManaColor } from "./classify";
import {
  cardsSeenByTurn,
  colorSourceProbability,
  hypergeomAtLeast,
  karstenLandBandForCommander,
  landDropProbability,
} from "./probability";

/** Quantos terrenos "a mais do que o turno" definem uma mão/board flodada. */
const FLOOD_EXCESS = 3;

export interface CurveBucket {
  cmc: number; // 6 representa "6+"
  count: number;
}

export interface ColorStat {
  color: ManaColor;
  sources: number;
  pips: number;
}

export interface TurnPoint {
  turn: number;
  probability: number;
}

export interface DeckStats {
  librarySize: number;
  totalCards: number;
  landCount: number;
  rampCount: number;
  drawCount: number;
  removalCount: number;
  tutorCount: number;
  nonlandCount: number;
  averageCMC: number;
  curve: CurveBucket[];
  colorStats: ColorStat[];
  karstenBand: { min: number; max: number; note: string };
  landDropByTurn: TurnPoint[];
  /** probabilidade de já estar "afogado" em terrenos (ver FLOOD_EXCESS) em cada turno. */
  floodProbabilityByTurn: TurnPoint[];
  /** probabilidade de ter perdido a curva de terrenos (o inverso de landDropByTurn). */
  screwProbabilityByTurn: TurnPoint[];
  colorProbabilityByTurn: Record<ManaColor, TurnPoint[]>;
  consistencyScore: ConsistencyScore;
}

export interface ConsistencyScoreItem {
  label: string;
  score: number; // 0-100
  weight: number; // soma dos pesos = 1
}

export interface ConsistencyScore {
  overall: number; // 0-100
  breakdown: ConsistencyScoreItem[];
}

export interface StatsOptions {
  onPlay: boolean;
  maxTurn: number;
}

function sumQty(cards: ClassifiedCard[], pred: (c: ClassifiedCard) => boolean): number {
  return cards
    .filter((c) => !c.isCommander)
    .filter(pred)
    .reduce((sum, c) => sum + c.quantity, 0);
}

export function computeDeckStats(
  cards: ClassifiedCard[],
  librarySize: number,
  opts: StatsOptions
): DeckStats {
  const libraryCards = cards.filter((c) => !c.isCommander);
  const totalCards = cards.reduce((s, c) => s + c.quantity, 0);
  const landCount = sumQty(cards, (c) => c.isLand);
  const rampCount = sumQty(cards, (c) => c.isRamp);
  const drawCount = sumQty(cards, (c) => c.isDraw);
  const removalCount = sumQty(cards, (c) => c.isRemoval);
  const tutorCount = sumQty(cards, (c) => c.isTutor);
  const nonlandCount = librarySize - landCount;

  let cmcWeightedSum = 0;
  const curveMap = new Map<number, number>();
  for (const c of libraryCards) {
    if (c.isLand) continue;
    const bucket = Math.min(6, Math.floor(c.cmc));
    curveMap.set(bucket, (curveMap.get(bucket) ?? 0) + c.quantity);
    cmcWeightedSum += c.cmc * c.quantity;
  }
  const averageCMC = nonlandCount > 0 ? cmcWeightedSum / nonlandCount : 0;
  const curve: CurveBucket[] = [0, 1, 2, 3, 4, 5, 6].map((cmc) => ({
    cmc,
    count: curveMap.get(cmc) ?? 0,
  }));

  const colorStats: ColorStat[] = ALL_COLORS.map((color) => {
    const sources = libraryCards.reduce(
      (sum, c) => sum + (c.producesColors.includes(color) ? c.quantity : 0),
      0
    );
    const pips = libraryCards.reduce(
      (sum, c) => sum + (c.pips[color] ?? 0) * c.quantity,
      0
    );
    return { color, sources, pips };
  });

  const landDropByTurn: TurnPoint[] = Array.from({ length: opts.maxTurn }, (_, i) => {
    const turn = i + 1;
    return { turn, probability: landDropProbability(librarySize, landCount, turn, opts.onPlay) };
  });

  const floodProbabilityByTurn: TurnPoint[] = Array.from({ length: opts.maxTurn }, (_, i) => {
    const turn = i + 1;
    const seen = cardsSeenByTurn(turn, opts.onPlay);
    return {
      turn,
      probability: hypergeomAtLeast(librarySize, landCount, seen, turn + FLOOD_EXCESS),
    };
  });

  const screwProbabilityByTurn: TurnPoint[] = landDropByTurn.map((p) => ({
    turn: p.turn,
    probability: 1 - p.probability,
  }));

  const colorProbabilityByTurn: Record<ManaColor, TurnPoint[]> = {} as Record<
    ManaColor,
    TurnPoint[]
  >;
  for (const stat of colorStats) {
    if (stat.sources === 0) {
      colorProbabilityByTurn[stat.color] = [];
      continue;
    }
    const pipsNeeded = Math.max(1, Math.round(stat.pips > 0 ? 1 : 0) || 1);
    colorProbabilityByTurn[stat.color] = Array.from({ length: opts.maxTurn }, (_, i) => {
      const turn = i + 1;
      return {
        turn,
        probability: colorSourceProbability(librarySize, stat.sources, pipsNeeded, turn, opts.onPlay),
      };
    });
  }

  const karstenBand = karstenLandBandForCommander(averageCMC);
  const consistencyScore = computeConsistencyScore({
    landCount,
    karstenBand,
    colorStats,
    colorProbabilityByTurn,
    rampCount,
    drawCount,
    removalCount,
    nonlandCount,
  });

  return {
    librarySize,
    totalCards,
    landCount,
    rampCount,
    drawCount,
    removalCount,
    tutorCount,
    nonlandCount,
    averageCMC,
    curve,
    colorStats,
    karstenBand,
    landDropByTurn,
    floodProbabilityByTurn,
    screwProbabilityByTurn,
    colorProbabilityByTurn,
    consistencyScore,
  };
}

/** Penaliza linearmente por carta fora da faixa [min,max], até chegar a 0. */
function bandScore(value: number, min: number, max: number, penaltyPerUnit: number): number {
  if (value >= min && value <= max) return 100;
  const distance = value < min ? min - value : value - max;
  return Math.max(0, 100 - distance * penaltyPerUnit);
}

interface ConsistencyInputs {
  landCount: number;
  karstenBand: { min: number; max: number };
  colorStats: ColorStat[];
  colorProbabilityByTurn: Record<ManaColor, TurnPoint[]>;
  rampCount: number;
  drawCount: number;
  removalCount: number;
  nonlandCount: number;
}

/**
 * Score de consistência 0-100, agregando três sinais com pesos declarados.
 * É uma heurística de apoio (como a faixa de terrenos de Karsten) — as
 * probabilidades exatas em cada seção do app são a fonte de verdade; este
 * número só resume tudo num único indicador para comparar decks.
 */
function computeConsistencyScore(inputs: ConsistencyInputs): ConsistencyScore {
  const landScore = bandScore(inputs.landCount, inputs.karstenBand.min, inputs.karstenBand.max, 8);

  const activeColors = inputs.colorStats.filter((c) => c.sources > 0 && c.pips > 0);
  const referenceTurn = 3;
  const colorScore =
    activeColors.length > 0
      ? (100 *
          activeColors.reduce((sum, c) => {
            const points = inputs.colorProbabilityByTurn[c.color];
            const point = points.find((p) => p.turn === referenceTurn) ?? points.at(-1);
            return sum + (point?.probability ?? 0);
          }, 0)) /
        activeColors.length
      : 100;

  const actionDensity =
    inputs.nonlandCount > 0
      ? (inputs.rampCount + inputs.drawCount + inputs.removalCount) / inputs.nonlandCount
      : 0;
  const actionScore = bandScore(actionDensity, 0.3, 0.55, 200);

  const breakdown: ConsistencyScoreItem[] = [
    { label: "Terrenos dentro da faixa recomendada", score: landScore, weight: 0.4 },
    { label: `Fontes de cor (turno ${referenceTurn})`, score: colorScore, weight: 0.35 },
    { label: "Densidade de rampa/compra/remoção", score: actionScore, weight: 0.25 },
  ];
  const overall = breakdown.reduce((sum, b) => sum + b.score * b.weight, 0);

  return { overall, breakdown };
}

export { cardsSeenByTurn };
