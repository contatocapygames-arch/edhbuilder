import type { DeckStats } from "../lib/stats";

export function StatTiles({ stats }: { stats: DeckStats }) {
  const tiles: { label: string; value: string }[] = [
    { label: "Cartas na biblioteca", value: String(stats.librarySize) },
    { label: "Terrenos", value: String(stats.landCount) },
    { label: "Rampa (não-terreno)", value: String(stats.rampCount) },
    { label: "Compra de cartas", value: String(stats.drawCount) },
    { label: "Remoção/interação", value: String(stats.removalCount) },
    { label: "Tutores", value: String(stats.tutorCount) },
    { label: "CMV médio (não-terreno)", value: stats.averageCMC.toFixed(2) },
    {
      label: "Terrenos recomendados*",
      value: `${stats.karstenBand.min}–${stats.karstenBand.max}`,
    },
  ];
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="value">{t.value}</div>
          <div className="label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
