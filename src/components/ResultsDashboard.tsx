import { useState } from "react";
import type { DeckStats } from "../lib/stats";
import { colorSourceProbability, landDropProbability } from "../lib/probability";
import { BarChart } from "./charts/BarChart";
import { LineChart, Legend, type LineSeries } from "./charts/LineChart";
import { ALL_COLORS, type ManaColor } from "../lib/classify";

const COLOR_NAMES: Record<ManaColor, string> = {
  W: "Branco",
  U: "Azul",
  B: "Preto",
  R: "Vermelho",
  G: "Verde",
  C: "Incolor",
};
const COLOR_HEX: Record<ManaColor, string> = {
  W: "var(--series-4)",
  U: "var(--series-1)",
  B: "var(--text-primary)",
  R: "var(--series-8)",
  G: "var(--series-6)",
  C: "var(--text-muted)",
};

export function ResultsDashboard({ stats, onPlay }: { stats: DeckStats; onPlay: boolean }) {
  const [checkTurn, setCheckTurn] = useState(4);
  const [checkMana, setCheckMana] = useState(4);
  const [checkColor, setCheckColor] = useState<ManaColor>("U");
  const [checkPips, setCheckPips] = useState(1);

  const activeColors = stats.colorStats.filter((s) => s.sources > 0);

  const landSeries: LineSeries[] = [
    {
      id: "lands",
      label: "Chance de estar on-curve (terrenos)",
      color: "var(--series-1)",
      points: stats.landDropByTurn.map((p) => ({ x: p.turn, y: p.probability })),
    },
  ];

  const colorSeries: LineSeries[] = activeColors.map((s, i) => ({
    id: s.color,
    label: `${COLOR_NAMES[s.color]} (${s.sources} fontes)`,
    color: COLOR_HEX[s.color] ?? `var(--series-${(i % 8) + 1})`,
    points: (stats.colorProbabilityByTurn[s.color] ?? []).map((p) => ({
      x: p.turn,
      y: p.probability,
    })),
  }));

  const manaAtTurn = landDropProbability(stats.librarySize, stats.landCount, checkTurn, onPlay);
  const colorStat = stats.colorStats.find((s) => s.color === checkColor);
  const colorAtTurn = colorStat
    ? colorSourceProbability(stats.librarySize, colorStat.sources, checkPips, checkTurn, onPlay)
    : 0;

  return (
    <div className="card">
      <h2>2. Curva de mana</h2>
      <BarChart
        data={stats.curve.map((b) => ({ label: b.cmc === 6 ? "6+" : String(b.cmc), value: b.count }))}
        color="var(--series-1)"
      />

      <h2 style={{ marginTop: 24 }}>3. Consistência de mana (hipergeométrica exata)</h2>
      <p className="muted">
        Probabilidade calculada com a distribuição hipergeométrica: P(≥ k sucessos ao ver n
        cartas de um baralho de N com K sucessos). Modelo padrão usado por Frank Karsten e por
        calculadoras públicas de MTG.
      </p>
      <div className="grid-2">
        <div>
          <Legend series={landSeries} />
          <LineChart series={landSeries} />
        </div>
        <div>
          <Legend series={colorSeries} />
          <LineChart series={colorSeries} />
        </div>
      </div>

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Cor</th>
            <th>Fontes</th>
            <th>Pips no deck</th>
          </tr>
        </thead>
        <tbody>
          {ALL_COLORS.filter((c) => stats.colorStats.find((s) => s.color === c)!.sources > 0).map(
            (c) => {
              const s = stats.colorStats.find((x) => x.color === c)!;
              return (
                <tr key={c}>
                  <td>{COLOR_NAMES[c]}</td>
                  <td>{s.sources}</td>
                  <td>{s.pips}</td>
                </tr>
              );
            }
          )}
        </tbody>
      </table>

      <div className="row" style={{ marginTop: 16, alignItems: "flex-end" }}>
        <label>
          Verificar no turno
          <input
            type="number"
            min={1}
            max={20}
            value={checkTurn}
            onChange={(e) => setCheckTurn(parseInt(e.target.value, 10) || 1)}
          />
        </label>
        <div className="tile" style={{ minWidth: 220 }}>
          <div className="value">{(manaAtTurn * 100).toFixed(1)}%</div>
          <div className="label">chance de ter {checkTurn} terrenos até o turno {checkTurn}</div>
        </div>
        <label>
          Cor
          <select value={checkColor} onChange={(e) => setCheckColor(e.target.value as ManaColor)}>
            {ALL_COLORS.map((c) => (
              <option key={c} value={c}>
                {COLOR_NAMES[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pips necessários
          <input
            type="number"
            min={1}
            max={5}
            value={checkPips}
            onChange={(e) => setCheckPips(parseInt(e.target.value, 10) || 1)}
          />
        </label>
        <div className="tile" style={{ minWidth: 220 }}>
          <div className="value">{(colorAtTurn * 100).toFixed(1)}%</div>
          <div className="label">
            chance de ter {checkPips} fonte(s) de {COLOR_NAMES[checkColor]} até o turno{" "}
            {checkTurn}
          </div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        *Faixa de terrenos recomendada segue a heurística pública de Frank Karsten (faixas por CMV
        médio, validadas por simulação Monte Carlo) — é uma referência, não uma garantia; confie
        nos números exatos calculados acima para o seu deck específico.
      </p>
    </div>
  );
}
