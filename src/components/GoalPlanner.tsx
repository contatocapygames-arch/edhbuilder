import { useMemo, useState } from "react";
import type { ClassifiedCard } from "../lib/classify";
import {
  runGoalPlanSimulation,
  type CastRequirement,
  type CastTarget,
  type GoalMilestone,
  type GoalPlanConfig,
  type GoalPlanResult,
  type ManaColor,
} from "../lib/goalPlan";

const COLOR_LABEL: Record<ManaColor, string> = {
  W: "Branco",
  U: "Azul",
  B: "Preto",
  R: "Vermelho",
  G: "Verde",
  C: "Incolor",
};
const CATEGORY_LABEL = { ramp: "Rampa", tutor: "Tutor", draw: "Compra", removal: "Remoção" } as const;
type Category = keyof typeof CATEGORY_LABEL;

type RowKind = "landCount" | "manaAvailable" | "colorSources" | "castCard" | "castCount";
type TargetKind = "commander" | "card" | "category" | "cmc";

interface MilestoneRow {
  id: string;
  kind: RowKind;
  turn: number;
  minLands: number;
  minMana: number;
  color: ManaColor;
  minSources: number;
  targetKind: TargetKind;
  targetCardName: string;
  targetCategory: Category;
  targetCmc: number;
  minCount: number;
}

let rowCounter = 0;
function newRow(): MilestoneRow {
  return {
    id: `goal${rowCounter++}`,
    kind: "landCount",
    turn: 1,
    minLands: 1,
    minMana: 1,
    color: "U",
    minSources: 1,
    targetKind: "commander",
    targetCardName: "",
    targetCategory: "ramp",
    targetCmc: 2,
    minCount: 1,
  };
}

function cardRequirement(c: ClassifiedCard): CastRequirement {
  const pips: Partial<Record<ManaColor, number>> = {};
  (Object.entries(c.pips) as [ManaColor, number][]).forEach(([color, n]) => {
    if (n > 0) pips[color] = n;
  });
  return { cmc: c.cmc, pips };
}

export function GoalPlanner({
  cards,
  librarySize,
  onPlay,
}: {
  cards: ClassifiedCard[];
  librarySize: number;
  onPlay: boolean;
}) {
  const commander = useMemo(() => cards.find((c) => c.isCommander), [cards]);
  const castableCards = useMemo(
    () => cards.filter((c) => !c.isCommander && !c.isLand).sort((a, b) => a.name.localeCompare(b.name)),
    [cards]
  );
  const lands = useMemo(
    () =>
      cards
        .filter((c) => c.isLand && !c.isCommander)
        .flatMap((c) => Array.from({ length: c.quantity }, () => ({ producesColors: c.producesColors }))),
    [cards]
  );
  const categoryCards = useMemo(() => {
    const byCategory: GoalPlanConfig["categoryCards"] = { ramp: [], tutor: [], draw: [], removal: [] };
    const flags: Record<Category, keyof ClassifiedCard> = {
      ramp: "isRamp",
      tutor: "isTutor",
      draw: "isDraw",
      removal: "isRemoval",
    };
    for (const c of cards) {
      if (c.isCommander || c.isLand) continue;
      for (const cat of Object.keys(flags) as Category[]) {
        if (c[flags[cat]]) {
          byCategory[cat].push({
            requirement: cardRequirement(c),
            copies: c.quantity,
            manaProduced: cat === "ramp" ? c.manaProduced : undefined,
            manaDuration: cat === "ramp" && c.isRitual ? "oneShot" : undefined,
          });
        }
      }
    }
    return byCategory;
  }, [cards]);

  const [rows, setRows] = useState<MilestoneRow[]>([newRow(), newRow()]);
  const [trials, setTrials] = useState(15000);
  const [result, setResult] = useState<GoalPlanResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addRow() {
    setRows((r) => [...r, newRow()]);
  }
  function removeRow(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
  }
  function updateRow(id: string, patch: Partial<MilestoneRow>) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function rowLabel(row: MilestoneRow): string {
    if (row.kind === "landCount") return `Turno ${row.turn}: pelo menos ${row.minLands} terreno(s) em jogo`;
    if (row.kind === "manaAvailable")
      return `Turno ${row.turn}: pelo menos ${row.minMana} mana disponível (terrenos + rampa em jogo)`;
    if (row.kind === "colorSources")
      return `Turno ${row.turn}: pelo menos ${row.minSources} fonte(s) de ${COLOR_LABEL[row.color]}`;
    const targetLabel =
      row.targetKind === "commander"
        ? "o Comandante"
        : row.targetKind === "card"
          ? row.targetCardName || "(escolha uma carta)"
          : row.targetKind === "cmc"
            ? `algo de CMV ${row.targetCmc}`
            : CATEGORY_LABEL[row.targetCategory];
    if (row.kind === "castCard") return `Turno ${row.turn}: conseguir conjurar ${targetLabel}`;
    return `Até o turno ${row.turn}: conjurar ${targetLabel} pelo menos ${row.minCount}x`;
  }

  function run() {
    setRunning(true);
    setError(null);
    try {
      const cmcCards: NonNullable<GoalPlanConfig["cmcCards"]> = {};
      function cmcTarget(cmc: number): Extract<CastTarget, { type: "cmc" }> {
        if (!(cmc in cmcCards)) {
          const matching = castableCards.filter((c) => c.cmc === cmc);
          const copies = matching.reduce((s, c) => s + c.quantity, 0);
          cmcCards[cmc] = copies > 0 ? [{ requirement: { cmc, pips: {} }, copies }] : [];
        }
        return { type: "cmc", cmc, label: `CMV ${cmc}` };
      }

      const milestones: GoalMilestone[] = rows.map((row) => {
        if (row.kind === "landCount") {
          return { id: row.id, kind: "landCount", turn: row.turn, minLands: row.minLands };
        }
        if (row.kind === "manaAvailable") {
          return { id: row.id, kind: "manaAvailable", turn: row.turn, minMana: row.minMana };
        }
        if (row.kind === "colorSources") {
          return {
            id: row.id,
            kind: "colorSources",
            turn: row.turn,
            color: row.color,
            minSources: row.minSources,
          };
        }
        const target =
          row.targetKind === "commander"
            ? ({ type: "commander" } as const)
            : row.targetKind === "category"
              ? ({ type: "category", category: row.targetCategory, label: CATEGORY_LABEL[row.targetCategory] } as const)
              : row.targetKind === "cmc"
                ? cmcTarget(row.targetCmc)
                : (() => {
                    const c = castableCards.find((x) => x.name === row.targetCardName);
                    if (!c) throw new Error(`Escolha uma carta válida para a meta "${rowLabel(row)}".`);
                    return {
                      type: "card" as const,
                      id: c.name,
                      label: c.name,
                      copies: c.quantity,
                      requirement: cardRequirement(c),
                      manaProduced: c.isRamp ? c.manaProduced : undefined,
                      manaDuration: c.isRamp && c.isRitual ? ("oneShot" as const) : undefined,
                    };
                  })();
        if (row.kind === "castCard") {
          if (target.type === "category") {
            throw new Error(`"Conjurar carta" precisa de uma carta específica, CMV ou do Comandante, não uma categoria.`);
          }
          return { id: row.id, kind: "castCard", turn: row.turn, target };
        }
        return { id: row.id, kind: "castCount", byTurn: row.turn, target, minCount: row.minCount };
      });

      const res = runGoalPlanSimulation({
        deckSize: librarySize,
        lands,
        onPlay,
        milestones,
        commander: commander ? cardRequirement(commander) : undefined,
        categoryCards,
        cmcCards,
        trials,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card">
      <h2>6. Objetivos do deck (plano de jogo)</h2>
      <p className="muted">
        Monte uma sequência de metas — ex.: "turno 1, conjurar o Comandante" + "turno 2, ter 4
        manas disponíveis" ou "turno 3, conseguir conjurar algo de CMV 4". Todas são avaliadas{" "}
        <strong>juntas, na mesma partida simulada</strong> (não multiplicando probabilidades
        soltas), porque a mana gasta numa meta afeta a chance de bater a próxima. O resultado
        mostra a chance do plano completo e qual meta específica costuma travar. "Mana disponível"
        conta terrenos em jogo + rampa/rochas já conjuradas (Sol Ring, sinetes...), diferente de
        "terrenos em jogo" que só conta terrenos.
      </p>

      {rows.map((row) => (
        <div className="combo-group" key={row.id}>
          <div className="row" style={{ marginTop: 0 }}>
            <select value={row.kind} onChange={(e) => updateRow(row.id, { kind: e.target.value as RowKind })}>
              <option value="landCount">Terrenos em jogo</option>
              <option value="manaAvailable">Mana disponível (terrenos + rampa)</option>
              <option value="colorSources">Fontes de cor</option>
              <option value="castCard">Conjurar carta</option>
              <option value="castCount">Conjurar N vezes</option>
            </select>
            <button className="secondary" onClick={() => removeRow(row.id)}>
              Remover meta
            </button>
          </div>

          <div className="row">
            <label>
              {row.kind === "castCount" ? "Até o turno" : "No turno"}
              <input
                type="number"
                min={1}
                max={20}
                value={row.turn}
                onChange={(e) => updateRow(row.id, { turn: parseInt(e.target.value, 10) || 1 })}
              />
            </label>

            {row.kind === "landCount" && (
              <label>
                Mín. terrenos
                <input
                  type="number"
                  min={1}
                  value={row.minLands}
                  onChange={(e) => updateRow(row.id, { minLands: parseInt(e.target.value, 10) || 1 })}
                />
              </label>
            )}

            {row.kind === "manaAvailable" && (
              <label>
                Mín. mana
                <input
                  type="number"
                  min={1}
                  value={row.minMana}
                  onChange={(e) => updateRow(row.id, { minMana: parseInt(e.target.value, 10) || 1 })}
                />
              </label>
            )}

            {row.kind === "colorSources" && (
              <>
                <label>
                  Cor
                  <select value={row.color} onChange={(e) => updateRow(row.id, { color: e.target.value as ManaColor })}>
                    {(Object.keys(COLOR_LABEL) as ManaColor[]).map((c) => (
                      <option key={c} value={c}>
                        {COLOR_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mín. fontes
                  <input
                    type="number"
                    min={1}
                    value={row.minSources}
                    onChange={(e) => updateRow(row.id, { minSources: parseInt(e.target.value, 10) || 1 })}
                  />
                </label>
              </>
            )}

            {(row.kind === "castCard" || row.kind === "castCount") && (
              <>
                <label>
                  Alvo
                  <select
                    value={row.targetKind}
                    onChange={(e) => updateRow(row.id, { targetKind: e.target.value as TargetKind })}
                  >
                    <option value="commander" disabled={!commander}>
                      Comandante{!commander ? " (não detectado)" : ""}
                    </option>
                    <option value="card">Carta específica</option>
                    <option value="cmc">CMV específico</option>
                    {row.kind === "castCount" && <option value="category">Categoria</option>}
                  </select>
                </label>
                {row.targetKind === "cmc" && (
                  <label>
                    CMV
                    <input
                      type="number"
                      min={0}
                      max={16}
                      value={row.targetCmc}
                      onChange={(e) => updateRow(row.id, { targetCmc: parseInt(e.target.value, 10) || 0 })}
                    />
                  </label>
                )}
                {row.targetKind === "card" && (
                  <label>
                    Carta
                    <select
                      value={row.targetCardName}
                      onChange={(e) => updateRow(row.id, { targetCardName: e.target.value })}
                    >
                      <option value="">(escolha)</option>
                      {castableCards.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {row.targetKind === "category" && row.kind === "castCount" && (
                  <label>
                    Categoria
                    <select
                      value={row.targetCategory}
                      onChange={(e) => updateRow(row.id, { targetCategory: e.target.value as Category })}
                    >
                      {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABEL[cat]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {row.kind === "castCount" && (
                  <label>
                    Pelo menos
                    <input
                      type="number"
                      min={1}
                      value={row.minCount}
                      onChange={(e) => updateRow(row.id, { minCount: parseInt(e.target.value, 10) || 1 })}
                    />
                    x
                  </label>
                )}
              </>
            )}
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            {rowLabel(row)}
          </p>
        </div>
      ))}
      <button className="secondary" onClick={addRow}>
        + Adicionar meta
      </button>

      <div className="row">
        <label>
          Simulações
          <input
            type="number"
            min={1000}
            max={100000}
            step={1000}
            value={trials}
            onChange={(e) => setTrials(parseInt(e.target.value, 10) || 1000)}
          />
        </label>
        <button disabled={running || rows.length === 0} onClick={run}>
          {running ? "Simulando..." : "Simular plano"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div className="tile" style={{ maxWidth: 320 }}>
            <div className="value">{(result.overallProbability * 100).toFixed(1)}%</div>
            <div className="label">chance de bater o plano completo (todas as metas juntas)</div>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Meta</th>
                <th>Chance individual</th>
              </tr>
            </thead>
            <tbody>
              {result.perMilestone.map((m) => {
                const row = rows.find((r) => r.id === m.id);
                return (
                  <tr key={m.id}>
                    <td>{row ? rowLabel(row) : m.id}</td>
                    <td>{(m.probability * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 8 }}>
            A chance individual de cada meta ajuda a achar o gargalo do plano — se uma meta tem
            chance bem menor que as outras, é provavelmente ela que está travando o plano
            completo. Simplificação: pagar um custo colorido considera "terrenos em jogo ≥ custo
            total" e "fontes daquela cor ≥ pips daquela cor" separadamente, sem resolver que um
            terreno dual só paga 1 pip por vez.
          </p>
        </div>
      )}
    </div>
  );
}
