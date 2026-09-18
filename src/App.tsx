import { useState } from "react";
import { DeckInputForm, type DeckInputValues } from "./components/DeckInputForm";
import { StatTiles } from "./components/StatTiles";
import { CardTable } from "./components/CardTable";
import { ResultsDashboard } from "./components/ResultsDashboard";
import { EfficiencyPanel } from "./components/EfficiencyPanel";
import { ComboBuilder } from "./components/ComboBuilder";
import { GoalPlanner } from "./components/GoalPlanner";
import { parseDecklist, totalCardCount } from "./lib/deckParser";
import { fetchCardsByName } from "./lib/scryfall";
import { classifyCard, type ClassifiedCard } from "./lib/classify";
import { computeDeckStats, type DeckStats } from "./lib/stats";

const FORMAT_SIZE: Record<string, number> = {
  commander99: 100,
  standard60: 60,
  modern60: 60,
  pauper60: 60,
};

function App() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [fuzzyMatched, setFuzzyMatched] = useState<string[]>([]);
  const [cards, setCards] = useState<ClassifiedCard[] | null>(null);
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [onPlay, setOnPlay] = useState(true);
  const [maxTurn, setMaxTurn] = useState(12);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);

  async function handleAnalyze(values: DeckInputValues) {
    setLoading(true);
    setError(null);
    setNotFound([]);
    setFuzzyMatched([]);
    setSizeWarning(null);
    setProgress(null);
    try {
      const entries = parseDecklist(values.text);
      if (entries.length === 0) {
        throw new Error("Não foi possível reconhecer nenhuma carta na lista colada.");
      }
      const total = totalCardCount(entries);
      const expected =
        values.format === "custom" ? values.customSize : FORMAT_SIZE[values.format];
      if (expected && Math.abs(total - expected) > 0) {
        setSizeWarning(
          `A lista tem ${total} cartas; o esperado para este formato é ${expected}. As probabilidades usarão o tamanho real informado abaixo.`
        );
      }

      const { found, notFound: missing, fuzzyMatched: fuzzy } = await fetchCardsByName(
        entries.map((e) => e.name),
        (done, tot) => setProgress({ done, total: tot })
      );
      setNotFound(missing);
      setFuzzyMatched(fuzzy);

      const classified: ClassifiedCard[] = [];
      for (const entry of entries) {
        const card = found.get(entry.name.toLowerCase());
        if (!card) continue;
        classified.push(classifyCard(card, entry.quantity, entry.isCommander));
      }

      const commanderQty = classified
        .filter((c) => c.isCommander)
        .reduce((s, c) => s + c.quantity, 0);
      const totalParsed = classified.reduce((s, c) => s + c.quantity, 0);
      const librarySize =
        values.format === "custom"
          ? values.customSize
          : Math.max(1, totalParsed - commanderQty);

      const computed = computeDeckStats(classified, librarySize, {
        onPlay: values.onPlay,
        maxTurn: values.maxTurn,
      });

      setCards(classified);
      setStats(computed);
      setOnPlay(values.onPlay);
      setMaxTurn(values.maxTurn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCards(null);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <h1>EDH Builder — Análise Estatística de Deck</h1>
      <p className="subtitle">
        Cole sua lista, e o app busca cada carta no Scryfall (oracle text, tipos, cores, mana
        produzida) e calcula a consistência matemática do seu baralho: curva de mana,
        probabilidade de estar "on curve", fontes de cor e probabilidade de montar combos
        considerando tutores.
      </p>

      <DeckInputForm onAnalyze={handleAnalyze} loading={loading} progress={progress} />

      {error && <p className="error">{error}</p>}
      {sizeWarning && <p className="error" style={{ color: "var(--warning)" }}>{sizeWarning}</p>}
      {notFound.length > 0 && (
        <p className="error" style={{ color: "var(--warning)" }}>
          Cartas não encontradas no Scryfall (verifique a grafia): {notFound.join(", ")}
        </p>
      )}
      {fuzzyMatched.length > 0 && (
        <p className="muted" style={{ color: "var(--warning)" }}>
          Encontradas por correspondência aproximada (nome alternativo, ex. Secret Lair, ou só a
          face da frente de uma carta de duas faces) — confira se são as cartas certas:{" "}
          {fuzzyMatched.join(", ")}
        </p>
      )}

      {stats && cards && (
        <>
          <div className="card">
            <h2>Visão geral</h2>
            <StatTiles stats={stats} />
          </div>
          <ResultsDashboard stats={stats} onPlay={onPlay} />
          <EfficiencyPanel stats={stats} onPlay={onPlay} maxTurn={maxTurn} />
          <ComboBuilder
            cards={cards}
            librarySize={stats.librarySize}
            landCount={stats.landCount}
            onPlay={onPlay}
          />
          <GoalPlanner cards={cards} librarySize={stats.librarySize} onPlay={onPlay} />
          <div className="card">
            <h2>8. Todas as cartas classificadas</h2>
            <CardTable cards={cards} />
          </div>
        </>
      )}

      <footer>
        Fonte de dados: <a href="https://scryfall.com">Scryfall API</a> (oracle text, tipos, mana
        produzida). Modelo de probabilidade: distribuição hipergeométrica (compras sem reposição),
        seguindo a metodologia de Frank Karsten para fontes de mana, e simulação Monte Carlo para
        combos com tutores. Todo o processamento ocorre no seu navegador — nenhuma lista é enviada
        a um servidor além das consultas públicas ao Scryfall.
      </footer>
    </div>
  );
}

export default App;
