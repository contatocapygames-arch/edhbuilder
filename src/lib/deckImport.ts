/**
 * Importação de deck a partir de um link do Moxfield ou do Archidekt.
 *
 * Nenhum dos dois publica uma API oficial suportada para terceiros, mas
 * ambos expõem (no mesmo domínio, sem autenticação) o endpoint JSON que o
 * próprio site usa para renderizar a página do deck. Buscamos exatamente
 * esse endpoint público, direto do navegador — sem raspar HTML e sem
 * proxy. Isso pode falhar por CORS (comum no Moxfield, que fica atrás de
 * proteção anti-bot da Cloudflare); nesse caso, orientamos o usuário a
 * colar a lista exportada como texto na aba "Colar lista".
 */

export type ImportPlatform = "moxfield" | "archidekt";

export interface DetectedImport {
  platform: ImportPlatform;
  id: string;
}

const MOXFIELD_RE = /moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i;
const ARCHIDEKT_RE = /archidekt\.com\/decks\/(\d+)/i;

export function detectImportUrl(url: string): DetectedImport | null {
  const trimmed = url.trim();
  const moxfield = trimmed.match(MOXFIELD_RE);
  if (moxfield) return { platform: "moxfield", id: moxfield[1] };
  const archidekt = trimmed.match(ARCHIDEKT_RE);
  if (archidekt) return { platform: "archidekt", id: archidekt[1] };
  return null;
}

export interface ImportedDeck {
  text: string;
  sourceName: string;
  platform: ImportPlatform;
}

interface MoxfieldCardEntry {
  quantity: number;
  card: { name: string };
}
interface MoxfieldBoard {
  cards: Record<string, MoxfieldCardEntry>;
}
interface MoxfieldDeckResponse {
  name?: string;
  boards?: {
    commanders?: MoxfieldBoard;
    mainboard?: MoxfieldBoard;
    companions?: MoxfieldBoard;
  };
}

export function parseMoxfieldDeck(data: MoxfieldDeckResponse): string {
  const lines: string[] = [];
  const commanderCards = Object.values(data.boards?.commanders?.cards ?? {});
  if (commanderCards.length > 0) {
    lines.push("Commander");
    for (const entry of commanderCards) {
      lines.push(`${entry.quantity} ${entry.card.name}`);
    }
    lines.push("");
  }
  lines.push("Deck");
  const mainboard = Object.values(data.boards?.mainboard?.cards ?? {});
  const companions = Object.values(data.boards?.companions?.cards ?? {});
  for (const entry of [...mainboard, ...companions]) {
    lines.push(`${entry.quantity} ${entry.card.name}`);
  }
  if (mainboard.length === 0) {
    throw new Error(
      "A resposta do Moxfield não tinha o formato esperado (mainboard vazio). O layout do deck pode não ser suportado."
    );
  }
  return lines.join("\n");
}

interface ArchidektCardEntry {
  quantity: number;
  categories?: string[];
  card?: {
    oracleCard?: { name?: string };
    name?: string;
  };
}
interface ArchidektDeckResponse {
  name?: string;
  cards?: ArchidektCardEntry[];
}

const NON_DECK_CATEGORIES = ["maybeboard", "sideboard", "considering"];

export function parseArchidektDeck(data: ArchidektDeckResponse): string {
  const cards = data.cards ?? [];
  if (cards.length === 0) {
    throw new Error("A resposta do Archidekt não trouxe nenhuma carta.");
  }
  const commanderLines: string[] = [];
  const deckLines: string[] = [];
  for (const entry of cards) {
    const name = entry.card?.oracleCard?.name ?? entry.card?.name;
    if (!name) continue;
    const categories = (entry.categories ?? []).map((c) => c.toLowerCase());
    if (categories.some((c) => NON_DECK_CATEGORIES.includes(c))) continue;
    const line = `${entry.quantity} ${name}`;
    if (categories.includes("commander")) commanderLines.push(line);
    else deckLines.push(line);
  }
  if (deckLines.length === 0 && commanderLines.length === 0) {
    throw new Error(
      "Não foi possível reconhecer nenhuma carta na resposta do Archidekt."
    );
  }
  const parts: string[] = [];
  if (commanderLines.length > 0) parts.push("Commander", ...commanderLines, "");
  parts.push("Deck", ...deckLines);
  return parts.join("\n");
}

async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error(
      "Não foi possível conectar ao servidor de origem a partir do navegador (provavelmente bloqueio de CORS)."
    );
  }
  if (!res.ok) {
    throw new Error(`O servidor de origem respondeu ${res.status}. Verifique se o link do deck é público.`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error("A resposta não pôde ser lida (CORS bloqueou o acesso ao conteúdo).");
  }
}

export async function importDeckFromUrl(url: string): Promise<ImportedDeck> {
  const detected = detectImportUrl(url);
  if (!detected) {
    throw new Error(
      "Link não reconhecido. Cole um link de deck do Moxfield (moxfield.com/decks/...) ou do Archidekt (archidekt.com/decks/...)."
    );
  }
  if (detected.platform === "moxfield") {
    const data = (await fetchJson(
      `https://api.moxfield.com/v2/decks/all/${detected.id}`
    )) as MoxfieldDeckResponse;
    return { text: parseMoxfieldDeck(data), sourceName: data.name ?? "deck do Moxfield", platform: "moxfield" };
  }
  const data = (await fetchJson(
    `https://archidekt.com/api/decks/${detected.id}/`
  )) as ArchidektDeckResponse;
  return { text: parseArchidektDeck(data), sourceName: data.name ?? "deck do Archidekt", platform: "archidekt" };
}
