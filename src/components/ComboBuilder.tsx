import { useMemo, useState } from "react";
import type { ClassifiedCard } from "../lib/classify";
import { runComboSimulation, type SimResult } from "../lib/simulation";
import { LineChart, type LineSeries } from "./charts/LineChart";

interface ComboGroup {
  id: string;
  label: string;
  cardNames: string[];
}

interface TutorConfig {
  enabled: boolean;
  mode: "any" | "groups";
  groupIds: string[];
}

interface DrawConfig {
  enabled: boolean;
  mode: "burst" | "engine";
  cardsPerDraw: number;
}

let groupCounter = 0;

export function ComboBuilder({
  cards,
  librarySize,
  landCount,
  onPlay,
}: {
  cards: ClassifiedCard[];
  librarySize: number;
  landCount: number;
  onPlay: boolean;
}) {
  const selectableCards = useMemo(
    () => cards.filter((c) => !c.isCommander).sort((a, b) => a.name.localeCompare(b.name)),
    [cards]
  );
  const tutorCards = useMemo(() => cards.filter((c) => c.isTutor && !c.isCommander), [cards]);
  const drawCards = useMemo(() => cards.filter((c) => c.isDraw && !c.isCommander), [cards]);

  const [groups, setGroups] = useState<ComboGroup[]>([
    { id: `g${groupCounter++}`, label: "Peça 1", cardNames: [] },
    { id: `g${groupCounter++}`, label: "Peça 2", cardNames: [] },
  ]);
  const [tutorConfigs, setTutorConfigs] = useState<Record<string, TutorConfig>>({});
  const [drawConfigs, setDrawConfigs] = useState<Record<string, DrawConfig>>({});
  const [maxTurn, setMaxTurn] = useState(10);
  const [trials, setTrials] = useState(15000);
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getTutorConfig(name: string): TutorConfig {
    return tutorConfigs[name] ?? { enabled: false, mode: "any", groupIds: [] };
  }
  function setTutorConfig(name: string, patch: Partial<TutorConfig>) {
    setTutorConfigs((prev) => ({ ...prev, [name]: { ...getTutorConfig(name), ...patch } }));
  }

  function getDrawConfig(card: ClassifiedCard): DrawConfig {
    return (
      drawConfigs[card.name] ?? {
        enabled: false,
        mode: card.isRepeatableDraw ? "engine" : "burst",
        cardsPerDraw: Math.max(1, card.drawAmount),
      }
    );
  }
  function setDrawConfig(name: string, patch: Partial<DrawConfig>, card: ClassifiedCard) {
    setDrawConfigs((prev) => ({ ...prev, [name]: { ...getDrawConfig(card), ...patch } }));
  }

  function addGroup() {
    setGroups((g) => [...g, { id: `g${groupCounter++}`, label: `Peça ${g.length + 1}`, cardNames: [] }]);
  }
  function removeGroup(id: string) {
    setGroups((g) => g.filter((x) => x.id !== id));
  }
  function updateGroup(id: string, patch: Partial<ComboGroup>) {
    setGroups((g) => g.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function run() {
    setRunning(true);
    setError(null);
    try {
      const activeGroups = groups.filter((g) => g.cardNames.length > 0);
      const pieces = activeGroups.map((g) => {
        const matching = cards.filter((c) => g.cardNames.includes(c.name));
        return {
          id: g.id,
          copies: matching.reduce((sum, c) => sum + c.quantity, 0),
          // Peça-terreno (ex.: Dark Depths + Thespian's Stage) conta como a
          // jogada de terreno do turno quando comprada — só quando TODAS as
          // cartas escolhidas para o slot são terrenos.
          isLand: matching.length > 0 && matching.every((c) => c.isLand),
        };
      });

      const tutors = tutorCards
        .filter((t) => getTutorConfig(t.name).enabled)
        .map((t) => {
          const cfg = getTutorConfig(t.name);
          return {
            id: t.name,
            label: t.name,
            copies: t.quantity,
            cmc: t.cmc,
            targets: cfg.mode === "any" ? ("any" as const) : cfg.groupIds,
            speed: t.tutorSpeed ?? ("hand" as const),
          };
        });

      const drawSources = drawCards
        .filter((d) => getDrawConfig(d).enabled)
        .map((d) => {
          const cfg = getDrawConfig(d);
          return {
            id: d.name,
            label: d.name,
            copies: d.quantity,
            cmc: d.cmc,
            cardsPerDraw: Math.max(1, cfg.cardsPerDraw),
            mode: cfg.mode,
          };
        });

      // Terrenos que já viraram peça do combo não entram de novo como
      // "terreno de preenchimento" (senão o baralho contaria a mesma carta
      // duas vezes).
      const landPieceCopies = pieces
        .filter((p) => p.isLand)
        .reduce((s, p) => s + p.copies, 0);
      const effectiveLands = Math.max(0, landCount - landPieceCopies);

      const res = runComboSimulation({
        deckSize: librarySize,
        lands: effectiveLands,
        onPlay,
        pieces,
        tutors,
        drawSources,
        maxTurn,
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

  const series: LineSeries[] | null = result
    ? [
        {
          id: "combo",
          label: "Probabilidade do combo montado",
          color: "var(--series-7)",
          points: result.probabilityByTurn.map((p) => ({ x: p.turn, y: p.probability })),
        },
      ]
    : null;

  return (
    <div className="card">
      <h2>5. Probabilidade do combo (considerando tutores)</h2>
      <p className="muted">
        Defina os "slots" do seu combo (cada slot pode ter várias cartas redundantes — qualquer
        uma delas conta; terrenos também podem ser peça, ex.: Dark Depths + Thespian's Stage),
        marque quais tutores podem buscar quais slots, e quais cartas de compra usar para "cavar"
        o deck. O cálculo usa simulação Monte Carlo (baralho embaralhado, compras turno a turno,
        terrenos jogados, tutores/compra conjurados quando há mana — tutor primeiro (ação
        certeira), compra com o que sobrar), porque um tutor "busca qualquer carta" só resolve UM
        slot em falta por vez — isso não é exatamente capturado por uma fórmula fechada simples.
      </p>

      {groups.map((g) => (
        <div className="combo-group" key={g.id}>
          <div className="row" style={{ marginTop: 0 }}>
            <input
              type="text"
              value={g.label}
              onChange={(e) => updateGroup(g.id, { label: e.target.value })}
              style={{
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 8px",
                color: "var(--text-primary)",
              }}
            />
            <button className="secondary" onClick={() => removeGroup(g.id)}>
              Remover slot
            </button>
          </div>
          <select
            multiple
            value={g.cardNames}
            onChange={(e) =>
              updateGroup(g.id, {
                cardNames: Array.from(e.target.selectedOptions).map((o) => o.value),
              })
            }
          >
            {selectableCards.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.quantity}){c.isLand ? " — Terreno" : ""}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button className="secondary" onClick={addGroup}>
        + Adicionar slot do combo
      </button>

      <h3 style={{ marginTop: 20, fontSize: "0.95rem" }}>Tutores detectados</h3>
      {tutorCards.length === 0 && <p className="muted">Nenhum tutor detectado na lista.</p>}
      <div className="checklist">
        {tutorCards.map((t) => {
          const cfg = getTutorConfig(t.name);
          return (
            <div key={t.name}>
              <label>
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onChange={(e) => setTutorConfig(t.name, { enabled: e.target.checked })}
                />
                {t.name} (CMV {t.cmc}
                {t.tutorTargetHint ? ` — ${t.tutorTargetHint}` : ""})
              </label>
              {cfg.enabled && (
                <div className="row" style={{ marginLeft: 24, marginTop: 4 }}>
                  <label>
                    <input
                      type="radio"
                      name={`mode-${t.name}`}
                      checked={cfg.mode === "any"}
                      onChange={() => setTutorConfig(t.name, { mode: "any" })}
                    />
                    busca qualquer carta (wildcard)
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`mode-${t.name}`}
                      checked={cfg.mode === "groups"}
                      onChange={() => setTutorConfig(t.name, { mode: "groups" })}
                    />
                    só busca slots específicos:
                  </label>
                  {cfg.mode === "groups" &&
                    groups.map((g) => (
                      <label key={g.id}>
                        <input
                          type="checkbox"
                          checked={cfg.groupIds.includes(g.id)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...cfg.groupIds, g.id]
                              : cfg.groupIds.filter((id) => id !== g.id);
                            setTutorConfig(t.name, { groupIds: next });
                          }}
                        />
                        {g.label}
                      </label>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 20, fontSize: "0.95rem" }}>Cartas de compra detectadas</h3>
      <p className="muted">
        Compra de cartas também "cava" o deck em busca do combo, além dos tutores. Marque como
        "compra única" (ex.: Harmonize — resolve uma vez e se esgota) ou "motor recorrente" (ex.:
        Rhystic Study, Phyrexian Arena, Sylvan Library — uma vez em campo, compra de novo a cada
        turno seguinte). Simplificação: assume que o gatilho sempre resolve (não modela o
        oponente pagando para negar Rhystic Study/Mystic Remora).
      </p>
      {drawCards.length === 0 && <p className="muted">Nenhuma carta de compra detectada na lista.</p>}
      <div className="checklist">
        {drawCards.map((d) => {
          const cfg = getDrawConfig(d);
          return (
            <div key={d.name}>
              <label>
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onChange={(e) => setDrawConfig(d.name, { enabled: e.target.checked }, d)}
                />
                {d.name} (CMV {d.cmc})
              </label>
              {cfg.enabled && (
                <div className="row" style={{ marginLeft: 24, marginTop: 4 }}>
                  <label>
                    <input
                      type="radio"
                      name={`draw-mode-${d.name}`}
                      checked={cfg.mode === "burst"}
                      onChange={() => setDrawConfig(d.name, { mode: "burst" }, d)}
                    />
                    compra única
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`draw-mode-${d.name}`}
                      checked={cfg.mode === "engine"}
                      onChange={() => setDrawConfig(d.name, { mode: "engine" }, d)}
                    />
                    motor recorrente (todo turno seguinte)
                  </label>
                  <label>
                    cartas por ativação
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={cfg.cardsPerDraw}
                      onChange={(e) =>
                        setDrawConfig(d.name, { cardsPerDraw: parseInt(e.target.value, 10) || 1 }, d)
                      }
                      style={{ width: 56, marginLeft: 6 }}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="row">
        <label>
          Turnos
          <input
            type="number"
            min={1}
            max={20}
            value={maxTurn}
            onChange={(e) => setMaxTurn(parseInt(e.target.value, 10) || 1)}
          />
        </label>
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
        <button disabled={running} onClick={run}>
          {running ? "Simulando..." : "Simular combo"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {result && series && (
        <div style={{ marginTop: 16 }}>
          <LineChart series={series} />
          <div className="tiles" style={{ marginTop: 12 }}>
            <div className="tile">
              <div className="value">{(result.completionRate * 100).toFixed(1)}%</div>
              <div className="label">chance de montar até o turno {maxTurn}</div>
            </div>
            <div className="tile">
              <div className="value">
                {result.averageTurnCompleted ? result.averageTurnCompleted.toFixed(1) : "—"}
              </div>
              <div className="label">turno médio de conclusão (quando monta)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
