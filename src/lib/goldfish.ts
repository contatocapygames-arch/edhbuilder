/**
 * Simulação Monte Carlo "goldfish" (sem oponente): a cada turno, o jogador
 * compra, joga um terreno se tiver, e conjura o feitiço mais caro que
 * couber na mana disponível. Mede duas coisas que a hipergeométrica pura
 * não responde diretamente porque dependem da curva inteira, não de um
 * único grupo de cartas:
 *
 * - probabilidade de ter alguma jogada legal (uma carta castável na mão)
 *   em cada turno — um proxy de "quão raramente esse deck trava sem
 *   jogadas";
 * - mana média desperdiçada por turno (mana disponível menos o custo do
 *   que foi jogado) — um proxy de eficiência da curva.
 *
 * Simplificação assumida (documentada e testável): joga no máximo 1
 * feitiço por turno, escolhendo o mais caro que couber (não empilha vários
 * feitiços baratos no mesmo turno). Cartas são tratadas como fungíveis
 * dentro do seu bucket de CMV — a identidade da carta não importa aqui,
 * só a curva.
 */

import { createRng, shuffle } from "./rng";

export interface CurveInput {
  cmc: number; // 6 representa "6 ou mais"
  count: number;
}

export interface GoldfishConfig {
  deckSize: number;
  lands: number;
  curve: CurveInput[];
  onPlay: boolean;
  maxTurn: number;
  trials: number;
  startingHandSize?: number;
  seed?: number;
}

export interface GoldfishTurnStats {
  turn: number;
  legalPlayProbability: number;
  averageWastedMana: number;
  averageLandsInPlay: number;
}

type Token = { kind: "land" } | { kind: "spell"; cmc: number } | { kind: "other" };

function buildDeck(config: GoldfishConfig): Token[] {
  const deck: Token[] = [];
  for (let i = 0; i < config.lands; i++) deck.push({ kind: "land" });
  let spellSlots = 0;
  for (const bucket of config.curve) {
    for (let i = 0; i < bucket.count; i++) {
      deck.push({ kind: "spell", cmc: bucket.cmc });
      spellSlots++;
    }
  }
  const remaining = config.deckSize - config.lands - spellSlots;
  for (let i = 0; i < Math.max(0, remaining); i++) deck.push({ kind: "other" });
  if (deck.length !== config.deckSize) {
    throw new Error(
      `Configuração inconsistente: terrenos(${config.lands}) + curva(${spellSlots}) excede o tamanho do baralho (${config.deckSize}).`
    );
  }
  return deck;
}

export function runGoldfishSimulation(config: GoldfishConfig): GoldfishTurnStats[] {
  const rng = createRng(config.seed);
  const startingHand = config.startingHandSize ?? 7;

  const legalPlayCounts = new Array(config.maxTurn).fill(0);
  const wastedManaSum = new Array(config.maxTurn).fill(0);
  const landsInPlaySum = new Array(config.maxTurn).fill(0);

  for (let trial = 0; trial < config.trials; trial++) {
    const deck = buildDeck(config);
    shuffle(deck, rng);
    const hand: Token[] = deck.splice(0, startingHand);
    let libIndex = 0;
    const library = deck;
    let landsInPlay = 0;

    for (let turnIdx = 0; turnIdx < config.maxTurn; turnIdx++) {
      const turn = turnIdx + 1;
      if (!(config.onPlay && turn === 1) && libIndex < library.length) {
        hand.push(library[libIndex++]);
      }

      const landIdx = hand.findIndex((t) => t.kind === "land");
      if (landIdx >= 0) {
        hand.splice(landIdx, 1);
        landsInPlay++;
      }

      let bestIdx = -1;
      let bestCmc = -1;
      for (let i = 0; i < hand.length; i++) {
        const t = hand[i];
        if (t.kind === "spell" && t.cmc <= landsInPlay && t.cmc > bestCmc) {
          bestCmc = t.cmc;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        hand.splice(bestIdx, 1);
        legalPlayCounts[turnIdx]++;
        wastedManaSum[turnIdx] += landsInPlay - bestCmc;
      } else {
        wastedManaSum[turnIdx] += landsInPlay;
      }
      landsInPlaySum[turnIdx] += landsInPlay;
    }
  }

  return Array.from({ length: config.maxTurn }, (_, i) => ({
    turn: i + 1,
    legalPlayProbability: legalPlayCounts[i] / config.trials,
    averageWastedMana: wastedManaSum[i] / config.trials,
    averageLandsInPlay: landsInPlaySum[i] / config.trials,
  }));
}
