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
  const nonlandCards = useMemo(
    () => cards.filter((c) => !c.isLand && !c.isCommander).sort((a, b) => a.name.localeCompare(b.name)),
    [cards]
  );
  const tutorCards = useMemo(() => cards.filter((c) => c.isTutor && !c.isCommander), [cards]);

  const [groups, setGroups] = useState<ComboGroup[]>([
    { id: `g${groupCounter++}`, label: "Peça 1", cardNames: [] },
    { id: `g${groupCounter++}`, label: "Peça 2", cardNames: [] },
  ]);
  const [tutorConfigs, setTutorConfigs] = useState<Record<string, TutorConfig>>({});
  const [maxTurn, setMaxTurn] = useState(10);
  const [trials, setTrials] = useState(15000);
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);

  function getTutorConfig(name: string): TutorConfig {
    return tutorConfigs[name] ?? { enabled: false, mode: "any", groupIds: [] };
  }
  function setTutorConfig(name: string, patch: Partial<TutorConfig>) {
    setTutorConfigs((prev) => ({ ...prev, [name]: { ...getTutorConfig(name), ...patch } }));
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
    try {
      const activeGroups = groups.filter((g) => g.cardNames.length > 0);
      const pieces = activeGroups.map((g) => ({
        id: g.id,
        copies: cards
          .filter((c) => g.cardNames.includes(c.name))
          .reduce((sum, c) => sum + c.quantity, 0),
      }));

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

      const usedInPieces = new Set(pieces.map((p) => p.id));
      const totalPieceCopies = pieces.reduce((s, p) => s + p.copies, 0);
      const totalTutorCopies = tutors.reduce((s, t) => s + t.copies, 0);
      const remainingForLands = librarySize - totalPieceCopies - totalTutorCopies;
      const effectiveLands = Math.max(0, Math.min(landCount, remainingForLands));

      const res = runComboSimulation({
        deckSize: librarySize,
        lands: effectiveLands,
        onPlay,
        pieces,
        tutors,
        maxTurn,
        trials,
      });
      setResult(res);
      void usedInPieces;
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
      <h2>4. Probabilidade do combo (considerando tutores)</h2>
      <p className="muted">
        Defina os "slots" do seu combo (cada slot pode ter várias cartas redundantes — qualquer
        uma delas conta) e marque quais tutores podem buscar quais slots. O cálculo usa simulação
        Monte Carlo (baralho embaralhado, compras turno a turno, terrenos jogados, tutores
        conjurados quando há mana), porque um tutor "busca qualquer carta" só resolve UM slot em
        falta por vez — isso não é exatamente capturado por uma fórmula fechada simples.
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
            {nonlandCards.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.quantity})
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
