import { useState } from "react";
import { importDeckFromUrl } from "../lib/deckImport";

export type DeckFormat = "commander99" | "standard60" | "modern60" | "pauper60" | "custom";

export interface DeckInputValues {
  text: string;
  format: DeckFormat;
  customSize: number;
  onPlay: boolean;
  maxTurn: number;
}

const PLACEHOLDER = `Commander
1 Kinnan, Bonder Prodigy

Deck
1 Sol Ring
1 Arcane Signet
1 Demonic Tutor
1 Thassa's Oracle
1 Command Tower
36 outros terrenos...
`;

export function DeckInputForm({
  onAnalyze,
  loading,
  progress,
}: {
  onAnalyze: (values: DeckInputValues) => void;
  loading: boolean;
  progress: { done: number; total: number } | null;
}) {
  const [mode, setMode] = useState<"paste" | "link">("paste");
  const [text, setText] = useState("");
  const [format, setFormat] = useState<DeckFormat>("commander99");
  const [customSize, setCustomSize] = useState(99);
  const [onPlay, setOnPlay] = useState(true);
  const [maxTurn, setMaxTurn] = useState(12);

  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);

  async function handleImport() {
    setImporting(true);
    setImportError(null);
    setImportedFrom(null);
    try {
      const result = await importDeckFromUrl(importUrl);
      setText(result.text);
      setImportedFrom(result.sourceName);
      setMode("paste");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card">
      <h2>1. Sua lista de deck</h2>
      <div className="row" style={{ marginTop: 0 }}>
        <button
          className={mode === "paste" ? "" : "secondary"}
          onClick={() => setMode("paste")}
        >
          Colar lista
        </button>
        <button
          className={mode === "link" ? "" : "secondary"}
          onClick={() => setMode("link")}
        >
          Importar link (Moxfield/Archidekt)
        </button>
      </div>

      {mode === "link" && (
        <div style={{ marginTop: 12 }}>
          <p className="muted">
            Cole o link público do deck no Moxfield ou no Archidekt. A busca é feita direto do
            seu navegador (sem servidor); o Moxfield às vezes bloqueia esse acesso (proteção
            anti-bot) — se der erro, exporte a lista como texto lá e cole na aba "Colar lista".
          </p>
          <div className="row">
            <input
              type="text"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://www.moxfield.com/decks/... ou https://archidekt.com/decks/..."
              style={{
                flex: 1,
                minWidth: 280,
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 10px",
                color: "var(--text-primary)",
              }}
            />
            <button disabled={importing || importUrl.trim().length === 0} onClick={handleImport}>
              {importing ? "Importando..." : "Importar"}
            </button>
          </div>
          {importError && <p className="error">{importError}</p>}
        </div>
      )}

      {mode === "paste" && (
        <>
          <p className="muted">
            Formatos aceitos: "1 Sol Ring", "1x Sol Ring" ou apenas "Sol Ring" por linha. Uma
            linha/seção "Commander" marca o(s) comandante(s) (não entra na biblioteca para as
            probabilidades).
          </p>
          {importedFrom && (
            <p className="muted" style={{ color: "var(--good)" }}>
              Lista importada de "{importedFrom}". Revise abaixo antes de analisar.
            </p>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
          />
        </>
      )}

      <div className="row">
        <label>
          Formato
          <select value={format} onChange={(e) => setFormat(e.target.value as DeckFormat)}>
            <option value="commander99">Commander (99 + comandante)</option>
            <option value="standard60">60 cartas (Standard/Pioneer)</option>
            <option value="modern60">60 cartas (Modern/Legacy)</option>
            <option value="pauper60">60 cartas (Pauper)</option>
            <option value="custom">Tamanho customizado</option>
          </select>
        </label>
        {format === "custom" && (
          <label>
            Tamanho do baralho
            <input
              type="number"
              min={1}
              value={customSize}
              onChange={(e) => setCustomSize(parseInt(e.target.value, 10) || 1)}
            />
          </label>
        )}
        <label>
          <input type="checkbox" checked={onPlay} onChange={(e) => setOnPlay(e.target.checked)} />
          Jogando primeiro (on the play)
        </label>
        <label>
          Turnos a analisar
          <input
            type="number"
            min={1}
            max={20}
            value={maxTurn}
            onChange={(e) => setMaxTurn(parseInt(e.target.value, 10) || 1)}
          />
        </label>
      </div>
      <div className="row">
        <button
          disabled={loading || text.trim().length === 0}
          onClick={() => onAnalyze({ text, format, customSize, onPlay, maxTurn })}
        >
          {loading ? "Analisando..." : "Analisar deck"}
        </button>
        {loading && progress && (
          <span className="muted">
            Buscando cartas no Scryfall: {progress.done}/{progress.total}
          </span>
        )}
      </div>
    </div>
  );
}
