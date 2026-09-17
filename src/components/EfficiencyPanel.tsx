import { useMemo, useState } from "react";
import type { DeckStats } from "../lib/stats";
import { simulateMulliganStrategy, type MulliganResult } from "../lib/mulligan";
import { runGoldfishSimulation, type GoldfishTurnStats } from "../lib/goldfish";
import { LineChart, Legend, type LineSeries } from "./charts/LineChart";

function scoreColor(score: number): string {
  if (score >= 80) return "var(--good)";
  if (score >= 55) return "var(--warning)";
  return "var(--critical)";
}

export function EfficiencyPanel({
  stats,
  onPlay,
  maxTurn,
}: {
  stats: DeckStats;
  onPlay: boolean;
  maxTurn: number;
}) {
  const [minLands, setMinLands] = useState(2);
  const [maxLands, setMaxLands] = useState(5);

  const mulligan: MulliganResult = useMemo(
    () =>
      simulateMulliganStrategy({
        deckSize: stats.librarySize,
        lands: stats.landCount,
        minLands,
        maxLands,
        trials: 10000,
      }),
    [stats.librarySize, stats.landCount, minLands, maxLands]
  );

  const goldfish: GoldfishTurnStats[] = useMemo(
    () =>
      runGoldfishSimulation({
        deckSize: stats.librarySize,
        lands: stats.landCount,
        curve: stats.curve,
        onPlay,
        maxTurn,
        trials: 8000,
      }),
    [stats.librarySize, stats.landCount, stats.curve, onPlay, maxTurn]
  );

  const floodScrewSeries: LineSeries[] = [
    {
      id: "screw",
      label: "Perdeu a curva de terrenos (screw)",
      color: "var(--series-8)",
      points: stats.screwProbabilityByTurn.map((p) => ({ x: p.turn, y: p.probability })),
    },
    {
      id: "flood",
      label: "Afogado em terrenos (flood)",
      color: "var(--series-2)",
      points: stats.floodProbabilityByTurn.map((p) => ({ x: p.turn, y: p.probability })),
    },
  ];

  const legalPlaySeries: LineSeries[] = [
    {
      id: "legalplay",
      label: "Chance de ter uma jogada legal na mão",
      color: "var(--series-3)",
      points: goldfish.map((g) => ({ x: g.turn, y: g.legalPlayProbability })),
    },
  ];

  return (
    <div className="card">
      <h2>4. Eficiência e consistência do deck</h2>

      <div className="row" style={{ marginTop: 0, alignItems: "stretch" }}>
        <div className="tile" style={{ minWidth: 220 }}>
          <div className="value" style={{ color: scoreColor(stats.consistencyScore.overall) }}>
            {stats.consistencyScore.overall.toFixed(0)}/100
          </div>
          <div className="label">Score de consistência (heurística)</div>
        </div>
        <div className="muted" style={{ flex: 1, minWidth: 240 }}>
          <table>
            <tbody>
              {stats.consistencyScore.breakdown.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td>{(b.weight * 100).toFixed(0)}%</td>
                  <td style={{ color: scoreColor(b.score) }}>{b.score.toFixed(0)}/100</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted">
        Combina, com pesos declarados acima: terrenos dentro da faixa de Karsten, fontes de cor
        suficientes no turno 3, e densidade de rampa/compra/remoção (30–55% do deck não-terreno).
        É um resumo de apoio — as probabilidades exatas em cada seção acima são a fonte de verdade.
      </p>

      <h3 style={{ marginTop: 20, fontSize: "0.95rem" }}>Mana flood x mana screw (hipergeométrica exata)</h3>
      <p className="muted">
        "Screw" = não conseguiu manter o terreno em cada turno (inverso da seção 3). "Flood" =
        já comprou 3+ terrenos além do que o turno pede — mão travada em terrenos, sem gás.
      </p>
      <Legend series={floodScrewSeries} />
      <LineChart series={floodScrewSeries} />

      <h3 style={{ marginTop: 20, fontSize: "0.95rem" }}>Qualidade da mão inicial (mulligan, Monte Carlo)</h3>
      <p className="muted">
        Simula a regra de Londres: compra 7, mantém se os terrenos caírem na faixa abaixo, senão
        compra outros 7 (até 3 vezes) e desce cartas ao decidir manter.
      </p>
      <div className="row">
        <label>
          Mín. terrenos aceitável
          <input
            type="number"
            min={0}
            max={7}
            value={minLands}
            onChange={(e) => setMinLands(parseInt(e.target.value, 10) || 0)}
          />
        </label>
        <label>
          Máx. terrenos aceitável
          <input
            type="number"
            min={0}
            max={7}
            value={maxLands}
            onChange={(e) => setMaxLands(parseInt(e.target.value, 10) || 0)}
          />
        </label>
      </div>
      <div className="tiles" style={{ marginTop: 12 }}>
        <div className="tile">
          <div className="value">{(mulligan.keepRate * 100).toFixed(1)}%</div>
          <div className="label">mãos mantidas dentro da faixa</div>
        </div>
        <div className="tile">
          <div className="value">{mulligan.averageMulligans.toFixed(2)}</div>
          <div className="label">mulligans em média</div>
        </div>
        <div className="tile">
          <div className="value">{mulligan.averageFinalHandSize.toFixed(1)}</div>
          <div className="label">tamanho médio da mão final</div>
        </div>
        <div className="tile">
          <div className="value">{mulligan.averageLandsInFinalHand.toFixed(2)}</div>
          <div className="label">terrenos médios na mão final</div>
        </div>
      </div>

      <h3 style={{ marginTop: 20, fontSize: "0.95rem" }}>
        Simulação "goldfish" — chance de ter uma jogada legal por turno
      </h3>
      <p className="muted">
        Monte Carlo jogando sozinho: compra, desce terreno, conjura o feitiço mais caro que couber
        (no máx. 1 por turno). Mede quão raramente esse deck fica sem jogadas — um proxy de
        eficiência da curva completa (a hipergeométrica sozinha não responde isso, porque depende
        da curva inteira, não de um grupo de cartas).
      </p>
      <Legend series={legalPlaySeries} />
      <LineChart series={legalPlaySeries} />
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Turno</th>
            <th>Chance de jogada legal</th>
            <th>Mana média desperdiçada</th>
          </tr>
        </thead>
        <tbody>
          {goldfish
            .filter((_, i) => i < 8)
            .map((g) => (
              <tr key={g.turn}>
                <td>{g.turn}</td>
                <td>{(g.legalPlayProbability * 100).toFixed(1)}%</td>
                <td>{g.averageWastedMana.toFixed(2)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
