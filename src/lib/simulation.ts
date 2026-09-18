/**
 * Simulação Monte Carlo de "montar o combo".
 *
 * A hipergeométrica fechada (probability.ts) é exata para "pelo menos 1
 * sucesso de um grupo" e para cobertura de grupos DISJUNTOS. Mas tutores
 * "wildcard" (buscam qualquer carta) quebram essa exatidão: um único
 * tutor só pode resolver UMA peça em falta por vez, então ele não pode ser
 * somado como +1 sucesso em cada grupo simultaneamente. Isso, mais a
 * restrição de mana/turno para conjurar o tutor, é mais fácil (e mais
 * correto) de modelar por simulação do que por uma fórmula fechada — a
 * mesma abordagem usada por calculadoras de consistência publicadas
 * (ex.: Deck-u-lator, simulações de mana base de Karsten com "3.75
 * milhões de partidas amostradas").
 */

export interface SimPiece {
  id: string;
  label?: string;
  /** total de cópias no baralho que satisfazem esta peça (redundâncias já somadas). */
  copies: number;
  /**
   * true quando esta peça é (ou inclui apenas) terrenos — ex.: combos como
   * Dark Depths + Thespian's Stage. Uma peça-terreno comprada/buscada conta
   * como a jogada de terreno do turno, igual a um terreno comum; sem essa
   * flag ela ficaria "presa na mão" sem nunca virar mana/jogada de terreno.
   */
  isLand?: boolean;
}

export interface SimDrawSource {
  id: string;
  label: string;
  copies: number;
  /** custo de mana genérico necessário para conjurar. */
  cmc: number;
  /** quantas cartas cada ativação compra. */
  cardsPerDraw: number;
  /**
   * 'burst' = compra as cartas uma vez, ao ser conjurada, e se esgota (ex.:
   * Harmonize). 'engine' = fica em campo e compra `cardsPerDraw` cartas a
   * cada turno seguinte, sem precisar ser conjurada de novo (ex.: Rhystic
   * Study, Phyrexian Arena, Sylvan Library) — simplificação: assume que o
   * gatilho sempre resolve (não modela o oponente pagando para negar
   * Rhystic Study/Mystic Remora, nem o "put back" de Sylvan Library).
   */
  mode: "burst" | "engine";
}

export interface SimTutor {
  id: string;
  label: string;
  copies: number;
  /** custo de mana genérico necessário para conjurar. */
  cmc: number;
  /** ids de peças que este tutor pode buscar, ou 'any' (busca qualquer carta do baralho). */
  targets: string[] | "any";
  /** 'hand' = vai direto pra mão; 'top' = vai para o topo do baralho (compra no próximo turno). */
  speed: "hand" | "top";
}

export interface SimConfig {
  deckSize: number;
  lands: number;
  onPlay: boolean;
  pieces: SimPiece[];
  tutors: SimTutor[];
  /** compra de cartas avulsa ou recorrente (Rhystic Study, Phyrexian Arena, Harmonize...); opcional. */
  drawSources?: SimDrawSource[];
  maxTurn: number;
  trials: number;
  startingHandSize?: number;
  /** máximo de tutores conjurados por turno (padrão 1, aproximação conservadora). */
  tutorsPerTurn?: number;
  seed?: number;
}

export interface SimResult {
  probabilityByTurn: { turn: number; probability: number }[];
  averageTurnCompleted: number | null;
  completionRate: number;
  trials: number;
}

import { createRng, shuffle } from "./rng";

type Token =
  | { kind: "piece"; pieceId: string; isLand?: boolean }
  | { kind: "tutor"; tutorId: string }
  | { kind: "draw"; sourceId: string }
  | { kind: "land" }
  | { kind: "other" };

function buildDeck(config: SimConfig): Token[] {
  const deck: Token[] = [];
  for (const p of config.pieces) {
    for (let i = 0; i < p.copies; i++) deck.push({ kind: "piece", pieceId: p.id, isLand: p.isLand });
  }
  for (const t of config.tutors) {
    for (let i = 0; i < t.copies; i++) deck.push({ kind: "tutor", tutorId: t.id });
  }
  for (const d of config.drawSources ?? []) {
    for (let i = 0; i < d.copies; i++) deck.push({ kind: "draw", sourceId: d.id });
  }
  const usedSlots = deck.length;
  const landSlots = Math.max(0, config.lands);
  for (let i = 0; i < landSlots; i++) deck.push({ kind: "land" });
  const otherSlots = Math.max(0, config.deckSize - usedSlots - landSlots);
  for (let i = 0; i < otherSlots; i++) deck.push({ kind: "other" });

  if (deck.length !== config.deckSize) {
    throw new Error(
      `Configuração inconsistente: peças + tutores + compra (${usedSlots}) + terrenos(${landSlots}) excede o tamanho do baralho (${config.deckSize}).`
    );
  }
  return deck;
}

function runSingleTrial(
  config: SimConfig,
  rng: () => number
): number | null {
  const deck = buildDeck(config);
  shuffle(deck, rng);

  const startingHand = config.startingHandSize ?? 7;
  const hand: Token[] = deck.splice(0, startingHand);
  let libIndex = 0; // deck agora é a "biblioteca" restante, consumida do início
  const library = deck;

  const found = new Set<string>();
  const pieceById = new Map(config.pieces.map((p) => [p.id, p]));
  const tutorTargetById = new Map(config.tutors.map((t) => [t.id, t]));
  const drawSourceById = new Map((config.drawSources ?? []).map((d) => [d.id, d]));
  const activeEngines = new Set<string>();
  let landsInPlay = 0;
  let pendingTopNextDraw: Token | null = null;

  const markFound = (pieceId: string) => found.add(pieceId);
  const drawFromLibrary = (count: number) => {
    for (let i = 0; i < count; i++) {
      if (libIndex >= library.length) break;
      const tok = library[libIndex++];
      hand.push(tok);
      if (tok.kind === "piece") markFound(tok.pieceId);
    }
  };

  for (const tok of hand) if (tok.kind === "piece") markFound(tok.pieceId);
  if (found.size === config.pieces.length) return 0;

  const tutorsPerTurn = config.tutorsPerTurn ?? 1;

  for (let turn = 1; turn <= config.maxTurn; turn++) {
    // Motores de compra já em campo (Rhystic Study, Phyrexian Arena, Sylvan
    // Library...) disparam no início do turno, antes da compra normal.
    for (const sourceId of activeEngines) {
      const spec = drawSourceById.get(sourceId);
      if (spec) drawFromLibrary(spec.cardsPerDraw);
    }
    if (found.size === config.pieces.length) return turn;

    if (pendingTopNextDraw) {
      hand.push(pendingTopNextDraw);
      if (pendingTopNextDraw.kind === "piece") markFound(pendingTopNextDraw.pieceId);
      pendingTopNextDraw = null;
    } else if (!(config.onPlay && turn === 1)) {
      drawFromLibrary(1);
    }
    if (found.size === config.pieces.length) return turn;

    const landIdx = hand.findIndex((t) => t.kind === "land" || (t.kind === "piece" && t.isLand));
    if (landIdx >= 0) {
      hand.splice(landIdx, 1);
      landsInPlay++;
    }

    // Mana disponível no turno: gasta primeiro em tutor (ação certeira —
    // busca a peça que falta na hora), e só o que sobrar vai para compra
    // (cava mais fundo, mas sem garantia de achar a peça). Gastar em compra
    // primeiro faria a compra "morrer de fome" o tutor turno após turno
    // sempre que os dois competem pela mesma mana.
    let availableMana = landsInPlay;

    let castThisTurn = 0;
    let progress = true;
    while (progress && castThisTurn < tutorsPerTurn) {
      progress = false;
      const missing = config.pieces.map((p) => p.id).filter((id) => !found.has(id));
      if (missing.length === 0) break;
      const tutorIdx = hand.findIndex((t) => {
        if (t.kind !== "tutor") return false;
        const spec = tutorTargetById.get(t.tutorId);
        if (!spec || availableMana < spec.cmc) return false;
        if (spec.targets === "any") return true;
        return spec.targets.some((id) => missing.includes(id));
      });
      if (tutorIdx < 0) break;
      const tutorTok = hand[tutorIdx] as { kind: "tutor"; tutorId: string };
      const spec = tutorTargetById.get(tutorTok.tutorId)!;
      const target =
        spec.targets === "any" ? missing[0] : missing.find((id) => spec.targets.includes(id));
      if (!target) break;
      hand.splice(tutorIdx, 1);
      availableMana -= spec.cmc;
      const targetIsLand = pieceById.get(target)?.isLand;
      if (spec.speed === "hand") {
        hand.push({ kind: "piece", pieceId: target, isLand: targetIsLand });
        markFound(target);
      } else {
        pendingTopNextDraw = { kind: "piece", pieceId: target, isLand: targetIsLand };
      }
      castThisTurn++;
      progress = true;
    }
    if (found.size === config.pieces.length) return turn;

    let castingDraw = true;
    while (castingDraw) {
      castingDraw = false;
      let bestIdx = -1;
      let bestCmc = Infinity;
      for (let i = 0; i < hand.length; i++) {
        const t = hand[i];
        if (t.kind !== "draw") continue;
        const spec = drawSourceById.get(t.sourceId);
        if (spec && spec.cmc <= availableMana && spec.cmc < bestCmc) {
          bestCmc = spec.cmc;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      const tok = hand[bestIdx] as { kind: "draw"; sourceId: string };
      const spec = drawSourceById.get(tok.sourceId)!;
      hand.splice(bestIdx, 1);
      availableMana -= spec.cmc;
      if (spec.mode === "burst") {
        drawFromLibrary(spec.cardsPerDraw);
      } else {
        activeEngines.add(spec.id);
      }
      castingDraw = true;
    }

    if (found.size === config.pieces.length) return turn;
  }
  return null;
}

export function runComboSimulation(config: SimConfig): SimResult {
  if (config.pieces.length === 0) {
    return {
      probabilityByTurn: Array.from({ length: config.maxTurn }, (_, i) => ({
        turn: i + 1,
        probability: 1,
      })),
      averageTurnCompleted: 0,
      completionRate: 1,
      trials: config.trials,
    };
  }

  const rng = createRng(config.seed);
  const completions: (number | null)[] = new Array(config.trials);
  for (let i = 0; i < config.trials; i++) {
    completions[i] = runSingleTrial(config, rng);
  }

  const probabilityByTurn = Array.from({ length: config.maxTurn }, (_, idx) => {
    const turn = idx + 1;
    const successes = completions.filter((c) => c !== null && c <= turn).length;
    return { turn, probability: successes / config.trials };
  });

  const completedTurns = completions.filter((c): c is number => c !== null);
  const averageTurnCompleted =
    completedTurns.length > 0
      ? completedTurns.reduce((a, b) => a + b, 0) / completedTurns.length
      : null;

  return {
    probabilityByTurn,
    averageTurnCompleted,
    completionRate: completedTurns.length / config.trials,
    trials: config.trials,
  };
}
