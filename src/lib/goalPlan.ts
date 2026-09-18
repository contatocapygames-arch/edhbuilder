/**
 * Simulação Monte Carlo de "plano de jogo": uma sequência de metas por turno
 * (ex.: "turno 1, conjurar o comandante" + "turno 2, ter 4 manas") avaliadas
 * JUNTAS, na mesma partida simulada — não como probabilidades independentes
 * multiplicadas. Isso importa porque a mana gasta numa meta afeta a chance
 * de bater a meta seguinte (exatamente o caso "comandante turno 1 E 4 manas
 * turno 2": se sobrar mana do comandante, ela conta pro turno 2 também).
 *
 * Reaproveita o mesmo padrão de token/turno dos outros simuladores do app
 * (simulation.ts, goldfish.ts), estendido para rastrear QUAL cor cada
 * terreno em jogo produz (não só a contagem), já que aqui as metas podem
 * exigir cores específicas simultaneamente.
 *
 * Simplificação assumida (mesma já usada na seção de "fontes de cor" do
 * app): pagar um custo colorido é aproximado por "terrenos em jogo >= custo
 * total" E "fontes daquela cor em jogo >= pips daquela cor", ignorando que
 * um terreno dual só pode pagar UM pip por vez (não os dois cores ao mesmo
 * tempo). É uma aproximação documentada, não uma resolução exata de
 * alocação de mana.
 */

import { createRng, shuffle } from "./rng";

export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";

export interface CastRequirement {
  cmc: number;
  pips: Partial<Record<ManaColor, number>>;
}

/** Cópias de um alvo conjurável, com quanta mana ele acrescenta ao ser conjurado (rampa/rochas). */
export interface TargetSpec {
  requirement: CastRequirement;
  copies: number;
  manaProduced?: number;
  /**
   * "oneShot" (rituais como Dark Ritual): a mana só conta no turno em que a
   * carta foi conjurada. "permanent" (padrão, rochas/dorks): continua
   * disponível nos turnos seguintes.
   */
  manaDuration?: "permanent" | "oneShot";
}

export type CastTarget =
  | { type: "commander" }
  | {
      type: "card";
      id: string;
      label: string;
      copies: number;
      requirement: CastRequirement;
      manaProduced?: number;
      manaDuration?: "permanent" | "oneShot";
    }
  | { type: "category"; category: "ramp" | "tutor" | "draw" | "removal"; label: string }
  /** "qualquer carta do deck com esse CMV exato" — ignora pips de cor específicos (só checa mana total). */
  | { type: "cmc"; cmc: number; label: string };

export type GoalMilestone =
  | { id: string; kind: "landCount"; turn: number; minLands: number }
  | { id: string; kind: "colorSources"; turn: number; color: ManaColor; minSources: number }
  /** terrenos EM JOGO + mana de rampa/rochas já conjuradas (Sol Ring, sinetes...), não só terrenos. */
  | { id: string; kind: "manaAvailable"; turn: number; minMana: number }
  | {
      id: string;
      kind: "castCard";
      turn: number;
      target: Extract<CastTarget, { type: "commander" | "card" | "cmc" }>;
    }
  | { id: string; kind: "castCount"; byTurn: number; target: CastTarget; minCount: number };

const COMMANDER_ID = "__commander__";

export interface GoalPlanConfig {
  deckSize: number;
  /** terrenos do baralho, cada um com as cores que produz (fontes duplas contam para as duas). */
  lands: { producesColors: ManaColor[] }[];
  onPlay: boolean;
  milestones: GoalMilestone[];
  /** custo do comandante (obrigatório se alguma meta referenciar target.type === "commander"). */
  commander?: CastRequirement;
  /** cartas do baralho marcadas por categoria (para metas do tipo "conjurar 1 rampa"), com custo. */
  categoryCards: Record<"ramp" | "tutor" | "draw" | "removal", TargetSpec[]>;
  /** cartas do baralho agrupadas por CMV exato (para metas do tipo "conjurar algo de CMV 3"). */
  cmcCards?: Record<number, TargetSpec[]>;
  trials: number;
  startingHandSize?: number;
  seed?: number;
}

export interface GoalPlanResult {
  /** probabilidade de bater TODAS as metas, na mesma partida. */
  overallProbability: number;
  /** probabilidade marginal de cada meta individual (diagnóstico de gargalo). */
  perMilestone: { id: string; probability: number }[];
  trials: number;
}

type LandToken = { kind: "land"; colors: ManaColor[] };
type CardToken = {
  kind: "card";
  targetId: string;
  requirement: CastRequirement;
  manaProduced?: number;
  manaDuration?: "permanent" | "oneShot";
};
type OtherToken = { kind: "other" };
type Token = LandToken | CardToken | OtherToken;

function requirementCastable(
  req: CastRequirement,
  landsInPlay: number,
  sourcesByColor: Record<ManaColor, number>
): boolean {
  if (landsInPlay < req.cmc) return false;
  for (const [color, need] of Object.entries(req.pips) as [ManaColor, number][]) {
    if ((sourcesByColor[color] ?? 0) < (need ?? 0)) return false;
  }
  return true;
}

function categoryTargetId(category: string, requirement: CastRequirement): string {
  return `__category_${category}_${requirement.cmc}_${JSON.stringify(requirement.pips)}`;
}

function cmcTargetId(cmc: number, requirement: CastRequirement): string {
  return `__cmc_${cmc}_${requirement.cmc}_${JSON.stringify(requirement.pips)}`;
}

function buildDeckTargets(config: GoalPlanConfig): Map<string, TargetSpec> {
  const targets = new Map<string, TargetSpec>();
  // Rampa sempre entra na simulação, mesmo sem nenhuma meta que a referencie
  // diretamente: sua mana afeta a chance de bater QUALQUER meta (comandante,
  // CMV específico, mana disponível...), não só metas do tipo "conjurar rampa".
  for (const c of config.categoryCards.ramp) {
    const id = categoryTargetId("ramp", c.requirement);
    if (!targets.has(id)) targets.set(id, c);
  }
  for (const m of config.milestones) {
    const t = m.kind === "castCard" || m.kind === "castCount" ? m.target : null;
    if (!t || t.type === "commander") continue;
    if (t.type === "card" && !targets.has(t.id)) {
      targets.set(t.id, {
        requirement: t.requirement,
        copies: t.copies,
        manaProduced: t.manaProduced,
        manaDuration: t.manaDuration,
      });
    }
    if (t.type === "category") {
      for (const c of config.categoryCards[t.category]) {
        const id = categoryTargetId(t.category, c.requirement);
        if (!targets.has(id)) targets.set(id, c);
      }
    }
    if (t.type === "cmc") {
      for (const c of config.cmcCards?.[t.cmc] ?? []) {
        const id = cmcTargetId(t.cmc, c.requirement);
        if (!targets.has(id)) targets.set(id, c);
      }
    }
  }
  return targets;
}

function categoryTargetIds(config: GoalPlanConfig, category: "ramp" | "tutor" | "draw" | "removal"): string[] {
  return config.categoryCards[category].map((c) => categoryTargetId(category, c.requirement));
}

function cmcTargetIds(config: GoalPlanConfig, cmc: number): string[] {
  return (config.cmcCards?.[cmc] ?? []).map((c) => cmcTargetId(cmc, c.requirement));
}

/** Soma quantas vezes um alvo (carta específica, comandante, categoria ou CMV) foi conjurado. */
function totalCastCount(
  config: GoalPlanConfig,
  castCount: Map<string, number>,
  target: CastTarget
): number {
  if (target.type === "commander") return castCount.get(COMMANDER_ID) ?? 0;
  if (target.type === "card") return castCount.get(target.id) ?? 0;
  if (target.type === "category") {
    let total = 0;
    for (const id of categoryTargetIds(config, target.category)) total += castCount.get(id) ?? 0;
    return total;
  }
  let total = 0;
  for (const id of cmcTargetIds(config, target.cmc)) total += castCount.get(id) ?? 0;
  return total;
}

function buildDeck(config: GoalPlanConfig, targets: Map<string, TargetSpec>): Token[] {
  const deck: Token[] = [];
  for (const l of config.lands) deck.push({ kind: "land", colors: l.producesColors });
  for (const [id, spec] of targets) {
    for (let i = 0; i < spec.copies; i++) {
      deck.push({
        kind: "card",
        targetId: id,
        requirement: spec.requirement,
        manaProduced: spec.manaProduced,
        manaDuration: spec.manaDuration,
      });
    }
  }
  const usedSlots = deck.length;
  const otherSlots = config.deckSize - usedSlots;
  for (let i = 0; i < Math.max(0, otherSlots); i++) deck.push({ kind: "other" });
  if (deck.length !== config.deckSize) {
    throw new Error(
      `Configuração inconsistente: terrenos + cartas-alvo (${usedSlots}) excede o tamanho do baralho (${config.deckSize}).`
    );
  }
  return deck;
}

function runSingleTrial(
  config: GoalPlanConfig,
  targets: Map<string, TargetSpec>,
  rng: () => number
): Map<string, boolean> {
  const deck = buildDeck(config, targets);
  shuffle(deck, rng);
  const startingHand = config.startingHandSize ?? 7;
  const hand: Token[] = deck.splice(0, startingHand);
  let libIndex = 0;
  const library = deck;

  const sourcesByColor: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let landsInPlay = 0;
  // Mana de rampa/rochas já conjuradas (Sol Ring, sinetes...), persiste entre turnos.
  let permanentExtraMana = 0;
  const castCount = new Map<string, number>();
  let commanderCast = false;

  const needsCommander = config.milestones.some(
    (m) =>
      (m.kind === "castCard" && m.target.type === "commander") ||
      (m.kind === "castCount" && m.target.type === "commander")
  );

  const maxTurn = Math.max(
    1,
    ...config.milestones.map((m) => (m.kind === "castCount" ? m.byTurn : m.turn))
  );

  const passed = new Map<string, boolean>();
  for (const m of config.milestones) passed.set(m.id, false);

  for (let turn = 1; turn <= maxTurn; turn++) {
    if (!(config.onPlay && turn === 1) && libIndex < library.length) {
      hand.push(library[libIndex++]);
    }

    const landIdx = hand.findIndex((t) => t.kind === "land");
    if (landIdx >= 0) {
      const land = hand[landIdx] as LandToken;
      hand.splice(landIdx, 1);
      landsInPlay++;
      for (const c of land.colors) sourcesByColor[c] = (sourcesByColor[c] ?? 0) + 1;
    }

    let availableMana = landsInPlay + permanentExtraMana;
    // Mana de rituais (instant/sorcery) conjurados NESTE turno: conta pra
    // "mana disponível" agora, mas não vira permanentExtraMana (some no
    // fim do turno, ao contrário de rochas/dorks).
    let turnRitualMana = 0;

    // O comandante fica sempre "disponível" na zona de comando — conjura
    // assim que der pra pagar, sem precisar ser comprado.
    if (needsCommander && !commanderCast && config.commander) {
      if (requirementCastable(config.commander, availableMana, sourcesByColor)) {
        availableMana -= config.commander.cmc;
        commanderCast = true;
        castCount.set(COMMANDER_ID, 1);
      }
    }

    // Conjura cartas-alvo em mão que já podem ser pagas (a mais barata primeiro).
    let progress = true;
    while (progress) {
      progress = false;
      let bestIdx = -1;
      let bestCmc = Infinity;
      for (let i = 0; i < hand.length; i++) {
        const t = hand[i];
        if (t.kind !== "card") continue;
        if (requirementCastable(t.requirement, availableMana, sourcesByColor) && t.requirement.cmc < bestCmc) {
          bestCmc = t.requirement.cmc;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      const tok = hand[bestIdx] as CardToken;
      hand.splice(bestIdx, 1);
      availableMana -= tok.requirement.cmc;
      castCount.set(tok.targetId, (castCount.get(tok.targetId) ?? 0) + 1);
      // Rampa/rochas conjuradas neste turno já liberam mana no mesmo turno
      // (paga o resto das ações). Rochas/dorks permanentes continuam
      // disponíveis nos turnos seguintes; rituais (instant/sorcery, ex.
      // Dark Ritual) são um estouro só deste turno — não entram em
      // permanentExtraMana.
      if (tok.manaProduced) {
        availableMana += tok.manaProduced;
        if (tok.manaDuration === "oneShot") {
          turnRitualMana += tok.manaProduced;
        } else {
          permanentExtraMana += tok.manaProduced;
        }
      }
      progress = true;
    }

    // Avalia as metas cujo turno é agora.
    for (const m of config.milestones) {
      if (m.kind === "landCount" && m.turn === turn) {
        passed.set(m.id, landsInPlay >= m.minLands);
      } else if (m.kind === "colorSources" && m.turn === turn) {
        passed.set(m.id, (sourcesByColor[m.color] ?? 0) >= m.minSources);
      } else if (m.kind === "manaAvailable" && m.turn === turn) {
        passed.set(m.id, landsInPlay + permanentExtraMana + turnRitualMana >= m.minMana);
      } else if (m.kind === "castCard" && m.turn === turn) {
        passed.set(m.id, totalCastCount(config, castCount, m.target) >= 1);
      }
    }
  }

  for (const m of config.milestones) {
    if (m.kind === "castCount") {
      passed.set(m.id, totalCastCount(config, castCount, m.target) >= m.minCount);
    }
  }

  return passed;
}

export function runGoalPlanSimulation(config: GoalPlanConfig): GoalPlanResult {
  if (config.milestones.length === 0) {
    return { overallProbability: 1, perMilestone: [], trials: config.trials };
  }
  const targets = buildDeckTargets(config);
  const rng = createRng(config.seed);

  const passCounts = new Map<string, number>();
  for (const m of config.milestones) passCounts.set(m.id, 0);
  let overallPasses = 0;

  for (let i = 0; i < config.trials; i++) {
    const result = runSingleTrial(config, targets, rng);
    let allPassed = true;
    for (const m of config.milestones) {
      if (result.get(m.id)) passCounts.set(m.id, (passCounts.get(m.id) ?? 0) + 1);
      else allPassed = false;
    }
    if (allPassed) overallPasses++;
  }

  return {
    overallProbability: overallPasses / config.trials,
    perMilestone: config.milestones.map((m) => ({
      id: m.id,
      probability: (passCounts.get(m.id) ?? 0) / config.trials,
    })),
    trials: config.trials,
  };
}
