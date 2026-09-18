/**
 * Cliente para a API pública do Scryfall (https://scryfall.com/docs/api).
 * Roda inteiramente no navegador: o Scryfall permite CORS para GET/POST a
 * partir de qualquer origem, então não precisamos de backend.
 *
 * Boas práticas seguidas (ver https://scryfall.com/docs/api):
 * - Lote de até 75 identificadores por chamada em /cards/collection.
 * - Pequeno atraso entre chamadas para não exceder a taxa recomendada.
 * - Cache local (localStorage) para evitar refazer buscas repetidas.
 */

export interface ScryfallCardFace {
  name: string;
  mana_cost?: string;
  oracle_text?: string;
  type_line?: string;
}

export interface ScryfallCard {
  id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  produced_mana?: string[];
  keywords: string[];
  layout: string;
  card_faces?: ScryfallCardFace[];
  legalities?: Record<string, string>;
}

const CACHE_PREFIX = "edhbuilder:scryfall:v1:";
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias
const COLLECTION_ENDPOINT = "https://api.scryfall.com/cards/collection";
const SEARCH_ENDPOINT = "https://api.scryfall.com/cards/search";
const NAMED_ENDPOINT = "https://api.scryfall.com/cards/named";
const CHUNK_SIZE = 75;
const REQUEST_DELAY_MS = 100;

function cacheKey(name: string): string {
  return CACHE_PREFIX + name.trim().toLowerCase();
}

function readCache(name: string): ScryfallCard | null {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { card: ScryfallCard; savedAt: number };
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed.card;
  } catch {
    return null;
  }
}

function writeCache(name: string, card: ScryfallCard): void {
  try {
    localStorage.setItem(
      cacheKey(name),
      JSON.stringify({ card, savedAt: Date.now() })
    );
  } catch {
    // localStorage indisponível/cheio: ignora cache silenciosamente.
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CollectionFetchResult {
  found: Map<string, ScryfallCard>; // chave: nome original solicitado (lowercase)
  notFound: string[];
  /** nomes resolvidos só na segunda tentativa (busca aproximada), não por match exato. */
  fuzzyMatched: string[];
}

/**
 * Busca uma carta por correspondência aproximada. O endpoint /cards/named
 * (https://scryfall.com/docs/api/cards/named) tolera o que /cards/collection
 * não tolera por exigir nome exato: nomes alternativos ("flavor name", comum
 * em Secret Lair/Universes Beyond), só o nome da face da frente em cartas de
 * duas faces, pequenos erros de digitação/acentuação etc.
 */
async function fetchCardByFuzzyName(name: string): Promise<ScryfallCard | null> {
  try {
    const res = await fetch(`${NAMED_ENDPOINT}?fuzzy=${encodeURIComponent(name)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as ScryfallCard;
  } catch {
    return null;
  }
}

/**
 * Busca cartas em lote pelo nome exato via /cards/collection e, para o que
 * não for encontrado (nomes alternativos, face da frente de cartas de duas
 * faces, pequenos erros), tenta de novo uma a uma via busca aproximada
 * (/cards/named?fuzzy=). Usa cache local antes de bater na rede.
 */
export async function fetchCardsByName(
  names: string[],
  onProgress?: (done: number, total: number) => void
): Promise<CollectionFetchResult> {
  const found = new Map<string, ScryfallCard>();
  const notFound: string[] = [];
  const uniqueNames = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));

  const toFetch: string[] = [];
  for (const name of uniqueNames) {
    const cached = readCache(name);
    if (cached) {
      found.set(name.toLowerCase(), cached);
    } else {
      toFetch.push(name);
    }
  }

  let done = found.size;
  onProgress?.(done, uniqueNames.length);

  const chunks = chunk(toFetch, CHUNK_SIZE);
  for (let i = 0; i < chunks.length; i++) {
    const batch = chunks[i];
    const identifiers = batch.map((name) => ({ name }));
    const res = await fetch(COLLECTION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) {
      throw new Error(
        `Scryfall respondeu ${res.status} ao buscar cartas. Tente novamente em alguns segundos.`
      );
    }
    const data = (await res.json()) as {
      data: ScryfallCard[];
      not_found?: { name?: string }[];
    };
    for (const card of data.data) {
      found.set(card.name.toLowerCase(), card);
      writeCache(card.name, card);
      // também cacheia pelo nome exatamente como o usuário digitou, se diferente
    }
    for (const nf of data.not_found ?? []) {
      if (nf.name) notFound.push(nf.name);
    }
    done += batch.length;
    onProgress?.(Math.min(done, uniqueNames.length), uniqueNames.length);
    if (i < chunks.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  // Resolve nomes originais (podem ter capitalização diferente da retornada)
  const resolved = new Map<string, ScryfallCard>();
  let stillMissing = Array.from(new Set(notFound));
  for (const name of uniqueNames) {
    const lower = name.toLowerCase();
    const hit = found.get(lower);
    if (hit) resolved.set(lower, hit);
    else if (!stillMissing.some((nf) => nf.toLowerCase() === lower)) {
      // Nome não veio exatamente igual (ex.: acentos) mas Scryfall pode ter
      // retornado por fuzzy match interno; tenta achar por proximidade simples.
      const alt = Array.from(found.values()).find(
        (c) => c.name.toLowerCase() === lower
      );
      if (alt) resolved.set(lower, alt);
      else stillMissing.push(name);
    }
  }
  stillMissing = Array.from(new Set(stillMissing));

  // Segunda tentativa: nomes alternativos (flavor name), face da frente de
  // cartas de duas faces, pequenos erros — um a um via busca aproximada.
  const fuzzyMatched: string[] = [];
  const trulyMissing: string[] = [];
  for (const name of stillMissing) {
    const card = await fetchCardByFuzzyName(name);
    if (card) {
      resolved.set(name.toLowerCase(), card);
      writeCache(card.name, card);
      writeCache(name, card); // cacheia também pelo alias buscado, para não repetir a busca aproximada
      fuzzyMatched.push(name);
    } else {
      trulyMissing.push(name);
    }
    done = Math.min(done + 1, uniqueNames.length);
    onProgress?.(done, uniqueNames.length);
    await sleep(REQUEST_DELAY_MS);
  }

  return { found: resolved, notFound: trulyMissing, fuzzyMatched };
}

/**
 * Enriquecimento OPCIONAL e best-effort: consulta as tags funcionais
 * ("oracle tags") mantidas pela comunidade no projeto Scryfall Tagger,
 * expostas via o operador de busca `otag:` (https://scryfall.com/docs/api/tags,
 * https://scryfall.com/docs/tagger-tags). Não é usado para nenhum cálculo
 * estatístico — apenas complementa a classificação heurística baseada em
 * oracle text com as tags "oficiais" da comunidade, quando disponíveis.
 * Falhas de rede/tag inexistente são silenciosamente ignoradas.
 */
export async function fetchNamesWithOracleTag(
  tag: string,
  names: string[]
): Promise<Set<string>> {
  const matched = new Set<string>();
  if (names.length === 0) return matched;
  for (const batch of chunk(names, 20)) {
    const nameClause = batch.map((n) => `!"${n.replace(/"/g, '\\"')}"`).join(" or ");
    const query = `otag:${tag} (${nameClause})`;
    try {
      const res = await fetch(
        `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&unique=cards`
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { data?: ScryfallCard[] };
      for (const card of data.data ?? []) matched.add(card.name.toLowerCase());
    } catch {
      // enriquecimento é best-effort; ignora erros de rede
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return matched;
}

export function primaryFace(card: ScryfallCard): {
  oracleText: string;
  typeLine: string;
  manaCost: string;
} {
  if (card.oracle_text || !card.card_faces?.length) {
    return {
      oracleText: card.oracle_text ?? "",
      typeLine: card.type_line ?? "",
      manaCost: card.mana_cost ?? "",
    };
  }
  const faces = card.card_faces;
  return {
    oracleText: faces.map((f) => f.oracle_text ?? "").join("\n"),
    typeLine: faces.map((f) => f.type_line ?? "").join(" // "),
    manaCost: faces[0].mana_cost ?? "",
  };
}
