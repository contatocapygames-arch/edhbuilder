/**
 * Simulação Monte Carlo de mulligan (regra de Londres): compra-se sempre 7
 * cartas novas a cada mulligan; ao decidir manter, colocam-se N cartas no
 * fundo do baralho (N = número de mulligans feitos), terminando com uma mão
 * de 7-N cartas.
 *
 * Não existe fórmula fechada simples para "taxa de mãos mantidas" porque a
 * decisão de manter depende de uma faixa de terrenos aceitável (não um
 * único valor), e o "bottom" pós-mulligan é uma escolha do jogador — por
 * isso simulamos, como no restante do motor Monte Carlo do app.
 *
 * Simplificação assumida (documentada e testável): ao colocar cartas no
 * fundo após decidir manter, o jogador prioriza levar a mão final para
 * dentro da faixa aceitável de terrenos quando possível (bottoming
 * "inteligente"), em vez de descartar cartas aleatoriamente.
 */

import { createRng, shuffle, type Rng } from "./rng";

export interface MulliganConfig {
  deckSize: number;
  lands: number;
  /** faixa de terrenos considerada uma mão "mantível" (padrão 2 a 5 de 7). */
  minLands?: number;
  maxLands?: number;
  /** número máximo de mulligans antes de ser forçado a manter (padrão 3). */
  maxMulligans?: number;
  trials: number;
  seed?: number;
}

export interface MulliganResult {
  keepRate: number; // fração de trials que mantiveram dentro da faixa (não forçados)
  forcedKeepRate: number; // fração que teve que manter fora da faixa (esgotou mulligans)
  averageMulligans: number;
  averageFinalHandSize: number;
  averageLandsInFinalHand: number;
}

function drawLandCount(deckSize: number, lands: number, handSize: number, rng: Rng): number {
  // Amostra sem reposição: constrói um baralho reduzido só de terreno/não-terreno
  // (suficiente para contar terrenos numa mão de handSize cartas).
  const deck: boolean[] = new Array(deckSize);
  for (let i = 0; i < deckSize; i++) deck[i] = i < lands;
  shuffle(deck, rng);
  let count = 0;
  for (let i = 0; i < handSize; i++) if (deck[i]) count++;
  return count;
}

export function simulateMulliganStrategy(config: MulliganConfig): MulliganResult {
  const minLands = config.minLands ?? 2;
  const maxLands = config.maxLands ?? 5;
  const maxMulligans = config.maxMulligans ?? 3;
  const rng = createRng(config.seed);

  let kept = 0;
  let forced = 0;
  let mulliganSum = 0;
  let finalHandSizeSum = 0;
  let finalLandsSum = 0;

  for (let trial = 0; trial < config.trials; trial++) {
    let mulligans = 0;
    let lands = drawLandCount(config.deckSize, config.lands, 7, rng);
    while (
      (lands < minLands || lands > maxLands) &&
      mulligans < maxMulligans
    ) {
      mulligans++;
      lands = drawLandCount(config.deckSize, config.lands, 7, rng);
    }

    const finalHandSize = 7 - mulligans;
    const inRange = lands >= minLands && lands <= maxLands;
    // Bottoming "inteligente": ao descartar `mulligans` cartas, empurra a mão
    // final para dentro da faixa quando possível.
    let finalLands = lands;
    if (mulligans > 0) {
      if (lands > maxLands) {
        finalLands = Math.max(maxLands, lands - mulligans);
      } else if (lands < minLands) {
        finalLands = lands; // não há como "criar" terrenos ao bottomar
      }
      finalLands = Math.min(finalLands, finalHandSize);
    }

    if (inRange) kept++;
    else forced++;
    mulliganSum += mulligans;
    finalHandSizeSum += finalHandSize;
    finalLandsSum += finalLands;
  }

  return {
    keepRate: kept / config.trials,
    forcedKeepRate: forced / config.trials,
    averageMulligans: mulliganSum / config.trials,
    averageFinalHandSize: finalHandSizeSum / config.trials,
    averageLandsInFinalHand: finalLandsSum / config.trials,
  };
}
