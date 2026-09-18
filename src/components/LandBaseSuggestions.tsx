import { useEffect, useMemo, useState } from "react";
import type { ClassifiedCard, ManaColor } from "../lib/classify";
import { CYCLE_LABEL, suggestLands, type LandCycleEntry } from "../lib/landDatabase";
import { fetchCardsByName, primaryFace, type ScryfallCard } from "../lib/scryfall";

const COLOR_LABEL: Record<ManaColor, string> = {
  W: "Branco",
  U: "Azul",
  B: "Preto",
  R: "Vermelho",
  G: "Verde",
  C: "Incolor",
};

function colorLabel(colors: ManaColor[]): string {
  if (colors.length === 0) return "Qualquer cor";
  return colors.map((c) => COLOR_LABEL[c]).join(" / ");
}

export function LandBaseSuggestions({ cards }: { cards: ClassifiedCard[] }) {
  const commander = useMemo(() => cards.find((c) => c.isCommander), [cards]);
  const identity = useMemo(() => {
    if (commander) return commander.colorIdentity;
    const set = new Set<ManaColor>();
    for (const c of cards) {
      if (c.isCommander) continue;
      for (const col of c.colorIdentity) set.add(col);
    }
    return Array.from(set);
  }, [cards, commander]);

  const ownedNames = useMemo(
    () => new Set(cards.map((c) => c.name.toLowerCase())),
    [cards]
  );

  const suggestions = useMemo(() => suggestLands(identity, ownedNames), [identity, ownedNames]);

  const [details, setDetails] = useState<Map<string, ScryfallCard>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (suggestions.length === 0) return;
    let cancelled = false;
    setLoading(true);
    fetchCardsByName(suggestions.map((s) => s.name))
      .then(({ found }) => {
        if (!cancelled) setDetails(found);
      })
      .catch(() => {
        // Enriquecimento é best-effort: se o Scryfall falhar, a lista de
        // nomes/cores já calculada localmente continua exibida normalmente.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions.map((s) => s.name).join("|")]);

  if (identity.length === 0) return null;

  const grouped = new Map<string, LandCycleEntry[]>();
  for (const s of suggestions) {
    const arr = grouped.get(s.cycle) ?? [];
    arr.push(s);
    grouped.set(s.cycle, arr);
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: "0.95rem" }}>Sugestões de land base</h3>
      <p className="muted">
        Terrenos de fixação de mana conhecidos (fetch, shock, pain, qualquer cor) cujas cores
        cabem na identidade de cor do deck ({colorLabel(identity)}) e que ainda não estão na sua
        lista. Terrenos que entram virados ficam por último, despriorizados, não excluídos. Base
        curada de ciclos clássicos — não é uma busca completa no Scryfall, e a legalidade/
        existência de cada carta é conferida ao vivo quando disponível.
        {loading && " Carregando detalhes do Scryfall..."}
      </p>
      {suggestions.length === 0 ? (
        <p className="muted">Nenhuma sugestão nova — ou o deck já tem esses terrenos, ou a identidade de cor não combina com a base curada.</p>
      ) : (
        Array.from(grouped.entries()).map(([cycle, lands]) => (
          <div key={cycle} style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: "0.85rem" }}>{CYCLE_LABEL[cycle as keyof typeof CYCLE_LABEL]}</strong>
            <table style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th>Carta</th>
                  <th>Cores</th>
                  <th>Oracle text</th>
                </tr>
              </thead>
              <tbody>
                {lands.map((l) => {
                  const card = details.get(l.name.toLowerCase());
                  const oracleText = card ? primaryFace(card).oracleText : null;
                  return (
                    <tr key={l.name}>
                      <td>
                        {l.name}
                        {l.entersTapped && <span className="badge">entra virado</span>}
                      </td>
                      <td>{colorLabel(l.colors)}</td>
                      <td className="muted" style={{ maxWidth: 420 }}>
                        {oracleText ?? (loading ? "…" : "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
