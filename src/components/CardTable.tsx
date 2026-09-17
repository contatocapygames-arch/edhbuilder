import type { ClassifiedCard } from "../lib/classify";

export function CardTable({ cards }: { cards: ClassifiedCard[] }) {
  const sorted = [...cards].sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name));
  return (
    <div style={{ maxHeight: 420, overflow: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Qtd</th>
            <th>Carta</th>
            <th>CMV</th>
            <th>Tipo</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.name}>
              <td>{c.quantity}</td>
              <td>
                {c.name}
                {c.isCommander && <span className="badge">Comandante</span>}
              </td>
              <td>{c.cmc}</td>
              <td className="muted">{c.typeLine}</td>
              <td>
                {c.isLand && <span className="badge land">Terreno</span>}
                {c.producesColors.length > 0 && !c.isLand && (
                  <span className="badge">Mana: {c.producesColors.join("")}</span>
                )}
                {c.isRamp && <span className="badge ramp">Rampa</span>}
                {c.isTutor && (
                  <span className="badge tutor">
                    Tutor{c.tutorTargetsAny ? " (qualquer carta)" : ""}
                  </span>
                )}
                {c.isDraw && <span className="badge draw">Compra</span>}
                {c.isRemoval && <span className="badge removal">Remoção</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
