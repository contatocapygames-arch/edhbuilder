import { primaryFace, type ScryfallCard } from "./scryfall";

export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
export const ALL_COLORS: ManaColor[] = ["W", "U", "B", "R", "G", "C"];

export interface ClassifiedCard {
  name: string;
  quantity: number;
  isCommander: boolean;
  cmc: number;
  typeLine: string;
  manaCost: string;
  colorIdentity: ManaColor[];
  oracleText: string;
  keywords: string[];
  isLand: boolean;
  /** cores que esta carta é capaz de produzir (terrenos, rochas, criaturas de mana). */
  producesColors: ManaColor[];
  isManaSource: boolean;
  isRamp: boolean;
  isTutor: boolean;
  tutorTargetsAny: boolean;
  tutorTargetHint: string | null;
  /** 'hand' = a carta buscada vai direto pra mão; 'top' = vai para o topo do baralho (compra no turno seguinte). */
  tutorSpeed: "hand" | "top" | null;
  isDraw: boolean;
  /** quantas cartas o primeiro efeito de compra detectado no texto compra (heurística, editável na UI). */
  drawAmount: number;
  /**
   * true para efeitos de compra recorrentes (gatilho de upkeep/passo de
   * compra, ou "sempre que um oponente conjura" como Rhystic Study/Mystic
   * Remora) — só um sinal para pré-selecionar "motor" vs "compra única" no
   * simulador de combo; o usuário pode corrigir manualmente.
   */
  isRepeatableDraw: boolean;
  isRemoval: boolean;
  /** pips de cada cor no custo de mana (para comparar com fontes disponíveis). */
  pips: Record<ManaColor, number>;
}

const BASIC_LAND_COLOR: Record<string, ManaColor> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
  wastes: "C",
};

function countPips(manaCost: string): Record<ManaColor, number> {
  const pips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const matches = manaCost.match(/\{([^}]+)\}/g) ?? [];
  for (const m of matches) {
    const inner = m.slice(1, -1).toUpperCase();
    // Híbrido (ex.: {W/U}) conta como pip fraco para ambas as cores.
    if (inner.includes("/")) {
      const parts = inner.split("/");
      for (const p of parts) {
        if ((ALL_COLORS as string[]).includes(p)) pips[p as ManaColor] += 0.5;
      }
      continue;
    }
    if ((ALL_COLORS as string[]).includes(inner)) {
      pips[inner as ManaColor] += 1;
    }
  }
  return pips;
}

function inferProducedColors(card: ScryfallCard, typeLine: string): ManaColor[] {
  if (card.produced_mana && card.produced_mana.length > 0) {
    return card.produced_mana.filter((c): c is ManaColor =>
      (ALL_COLORS as string[]).includes(c)
    );
  }
  // Fallback: terrenos básicos (e básicos com subtipo) sem produced_mana no payload.
  const lowerType = typeLine.toLowerCase();
  const found: ManaColor[] = [];
  for (const [subtype, color] of Object.entries(BASIC_LAND_COLOR)) {
    if (lowerType.includes(subtype)) found.push(color);
  }
  return found;
}

const RAMP_RE =
  /(add (one|two|three|x)?\s*(\{[wubrgc]\}|mana)|add \{[wubrgc0-9]\}|search your library for a basic land|additional land|extra land drop|play an additional land|put a land card)/i;
const TUTOR_RE = /search your library for (a|an|up to \w+|\d+)?\s*.*?card/i;
const TUTOR_ANY_RE = /search your library for (a|an|any) card\b(?!.*\b(basic land|creature|artifact|instant|sorcery|enchantment|planeswalker|land)\b)/i;
const TUTOR_TOP_RE =
  /search your library for[^.;]*(put (it|that card|those cards) on top of (your|their) library|reveal it,? (and )?put it on top)/i;
const DRAW_RE = /draw (a|an|two|three|four|five|six|\d+|x) (additional )?cards?/i;
const DRAW_ENGINE_RE =
  /(at the beginning of (your|each|each player's) (draw step|upkeep|end step)|whenever (an opponent|a player|another player) casts)/i;
const DRAW_WORD_TO_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/** Quantas cartas o primeiro efeito de compra do texto compra (0 se não houver). */
function parseDrawAmount(oracleText: string): number {
  const m = oracleText.match(DRAW_RE);
  if (!m) return 0;
  const token = m[1].toLowerCase();
  if (token === "x") return 1; // quantidade variável: default conservador, editável na UI
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  return DRAW_WORD_TO_NUMBER[token] ?? 1;
}

const REMOVAL_RE =
  /(destroy target|exile target|counter target spell|-\d+\/-\d+.*target|target (creature|permanent|player).*(sacrifice|gets? -)|deals? \d+ damage to target|return target .* to (its owner|hand))/i;

export function classifyCard(
  card: ScryfallCard,
  quantity: number,
  isCommander: boolean
): ClassifiedCard {
  const { oracleText, typeLine, manaCost } = primaryFace(card);
  const isLand = /\bland\b/i.test(typeLine);
  const producesColors = inferProducedColors(card, typeLine);
  const isManaSource = isLand || producesColors.length > 0 || /add \{?[wubrgc0-9]/i.test(oracleText);

  const tutorMatch = TUTOR_RE.test(oracleText);
  const isBasicLandTutor = /search your library for a basic land/i.test(oracleText);
  const tutorTargetsAny = TUTOR_ANY_RE.test(oracleText);

  let tutorTargetHint: string | null = null;
  if (tutorMatch) {
    const m = oracleText.match(/search your library for[^,.;]*/i);
    tutorTargetHint = m ? m[0].trim() : null;
  }

  return {
    name: card.name,
    quantity,
    isCommander,
    cmc: card.cmc,
    typeLine,
    manaCost,
    colorIdentity: card.color_identity.filter((c): c is ManaColor =>
      (ALL_COLORS as string[]).includes(c)
    ),
    oracleText,
    keywords: card.keywords ?? [],
    isLand,
    producesColors,
    isManaSource,
    isRamp: !isLand && (RAMP_RE.test(oracleText) || isBasicLandTutor),
    isTutor: tutorMatch && !isBasicLandTutor,
    tutorTargetsAny,
    tutorTargetHint,
    tutorSpeed: tutorMatch && !isBasicLandTutor ? (TUTOR_TOP_RE.test(oracleText) ? "top" : "hand") : null,
    isDraw: DRAW_RE.test(oracleText),
    drawAmount: parseDrawAmount(oracleText),
    isRepeatableDraw: DRAW_RE.test(oracleText) && DRAW_ENGINE_RE.test(oracleText),
    isRemoval: REMOVAL_RE.test(oracleText),
    pips: countPips(manaCost),
  };
}
