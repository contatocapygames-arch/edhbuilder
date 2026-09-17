export interface ParsedCardEntry {
  name: string;
  quantity: number;
  isCommander: boolean;
}

const SECTION_HEADERS = /^(commander|deck|maindeck|main deck|sideboard|companion|lands?)s?:?\s*$/i;

/**
 * Faz o parse de listas de deck em formatos comuns (MTGA/MTGO/Moxfield/
 * Archidekt): "1 Sol Ring", "1x Sol Ring", "Sol Ring", "1 Sol Ring (LTC) 123".
 * Uma linha começando com "Commander" isolada, ou dentro de uma seção
 * "Commander", marca a(s) carta(s) seguintes como comandante.
 */
export function parseDecklist(text: string): ParsedCardEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: ParsedCardEntry[] = [];
  let inCommanderSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    const headerMatch = line.match(SECTION_HEADERS);
    if (headerMatch) {
      inCommanderSection = /^commander/i.test(line);
      continue;
    }

    let working = line;
    let isCommander = inCommanderSection;
    const commanderPrefix = working.match(/^commander:\s*/i);
    if (commanderPrefix) {
      working = working.slice(commanderPrefix[0].length);
      isCommander = true;
    }
    working = working.replace(/\*(cmdr|commander)\*/gi, () => {
      isCommander = true;
      return "";
    });

    const qtyMatch = working.match(/^(\d+)\s*x?\s+(.*)$/i);
    let quantity = 1;
    let name = working;
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      name = qtyMatch[2];
    }

    // Remove sufixos de set/coleção: "(LTC) 123", "[LTC]", "*F*"
    name = name
      .replace(/\s*\([A-Za-z0-9]{2,6}\)\s*[\dA-Za-z-]*\s*$/g, "")
      .replace(/\s*\[[A-Za-z0-9]{2,6}\]\s*$/g, "")
      .replace(/\s*<[^>]*>\s*$/g, "")
      .trim();

    if (!name) continue;
    entries.push({ name, quantity, isCommander });
  }

  return mergeDuplicateNames(entries);
}

function mergeDuplicateNames(entries: ParsedCardEntry[]): ParsedCardEntry[] {
  const byName = new Map<string, ParsedCardEntry>();
  for (const e of entries) {
    const key = e.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.quantity += e.quantity;
      existing.isCommander = existing.isCommander || e.isCommander;
    } else {
      byName.set(key, { ...e });
    }
  }
  return Array.from(byName.values());
}

export function totalCardCount(entries: ParsedCardEntry[]): number {
  return entries.reduce((sum, e) => sum + e.quantity, 0);
}
