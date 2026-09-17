import { ALL_COLORS, type ClassifiedCard, type ManaColor } from "./classify";
import {
  cardsSeenByTurn,
  colorSourceProbability,
  karstenLandBandForCommander,
  landDropProbability,
} from "./probability";

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
  colorProbabilityByTurn: Record<ManaColor, TurnPoint[]>;
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
    karstenBand: karstenLandBandForCommander(averageCMC),
    landDropByTurn,
    colorProbabilityByTurn,
  };
}

export { cardsSeenByTurn };
