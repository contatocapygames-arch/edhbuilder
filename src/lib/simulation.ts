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

type Token =
  | { kind: "piece"; pieceId: string }
  | { kind: "tutor"; tutorId: string }
  | { kind: "land" }
  | { kind: "other" };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function buildDeck(config: SimConfig): Token[] {
  const deck: Token[] = [];
  for (const p of config.pieces) {
    for (let i = 0; i < p.copies; i++) deck.push({ kind: "piece", pieceId: p.id });
  }
  for (const t of config.tutors) {
    for (let i = 0; i < t.copies; i++) deck.push({ kind: "tutor", tutorId: t.id });
  }
  const usedSlots = deck.length;
  const landSlots = Math.max(0, config.lands);
  for (let i = 0; i < landSlots; i++) deck.push({ kind: "land" });
  const otherSlots = Math.max(0, config.deckSize - usedSlots - landSlots);
  for (let i = 0; i < otherSlots; i++) deck.push({ kind: "other" });

  if (deck.length !== config.deckSize) {
    throw new Error(
      `Configuração inconsistente: peças(${usedSlots}) + terrenos(${landSlots}) excede o tamanho do baralho (${config.deckSize}).`
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
  const tutorTargetById = new Map(config.tutors.map((t) => [t.id, t]));
  let landsInPlay = 0;
  let pendingTopNextDraw: Token | null = null;

  const markFound = (pieceId: string) => found.add(pieceId);
  for (const tok of hand) if (tok.kind === "piece") markFound(tok.pieceId);
  if (found.size === config.pieces.length) return 0;

  const tutorsPerTurn = config.tutorsPerTurn ?? 1;

  for (let turn = 1; turn <= config.maxTurn; turn++) {
    const draws: Token[] = [];
    if (pendingTopNextDraw) {
      draws.push(pendingTopNextDraw);
      pendingTopNextDraw = null;
    } else if (!(config.onPlay && turn === 1)) {
      if (libIndex < library.length) draws.push(library[libIndex++]);
    }
    for (const tok of draws) {
      hand.push(tok);
      if (tok.kind === "piece") markFound(tok.pieceId);
    }
    if (found.size === config.pieces.length) return turn;

    const landIdx = hand.findIndex((t) => t.kind === "land");
    if (landIdx >= 0) {
      hand.splice(landIdx, 1);
      landsInPlay++;
    }

    let castThisTurn = 0;
    let progress = true;
    while (progress && castThisTurn < tutorsPerTurn) {
      progress = false;
      const missing = config.pieces.map((p) => p.id).filter((id) => !found.has(id));
      if (missing.length === 0) break;
      const tutorIdx = hand.findIndex((t) => {
        if (t.kind !== "tutor") return false;
        const spec = tutorTargetById.get(t.tutorId);
        if (!spec || landsInPlay < spec.cmc) return false;
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
      if (spec.speed === "hand") {
        hand.push({ kind: "piece", pieceId: target });
        markFound(target);
      } else {
        pendingTopNextDraw = { kind: "piece", pieceId: target };
      }
      castThisTurn++;
      progress = true;
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

  const rng = config.seed !== undefined ? mulberry32(config.seed) : Math.random;
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
