import type { ManaColor } from "./classify";

export type LandCycle = "fetch" | "shock" | "pain" | "anycolor";

export interface LandCycleEntry {
  name: string;
  cycle: LandCycle;
  /** cores que a terreno produz/busca; [] = qualquer cor (ex.: Command Tower). */
  colors: ManaColor[];
  /** true para terrenos que normalmente entram virados (despriorizados, não excluídos). */
  entersTapped: boolean;
}

export const CYCLE_LABEL: Record<LandCycle, string> = {
  fetch: "Fetch land",
  shock: "Shock land",
  pain: "Pain land",
  anycolor: "Qualquer cor",
};

/**
 * Base curada de terrenos de fixação de mana conhecidos (ciclos clássicos e
 * amplamente jogados em Commander). Não é uma busca dinâmica no Scryfall —
 * é uma lista fixa de candidatos, filtrada pela identidade de cor do deck e
 * depois enriquecida com dados ao vivo do Scryfall (oracle text, existência)
 * em src/lib/scryfall.ts. Mantida deliberadamente pequena e bem conhecida
 * em vez de tentar cobrir todo ciclo de terreno já impresso. Triomes foram
 * excluídos de propósito (entram virados e o usuário pediu pra tirar);
 * terrenos que entram virados nos ciclos restantes ficam marcados e
 * aparecem por último, não excluídos.
 */
export const LAND_DATABASE: LandCycleEntry[] = [
  // Fetch lands (Onslaught/Zendikar) — buscam um terreno com o tipo básico certo.
  { name: "Arid Mesa", cycle: "fetch", colors: ["R", "W"], entersTapped: false },
  { name: "Bloodstained Mire", cycle: "fetch", colors: ["B", "R"], entersTapped: false },
  { name: "Flooded Strand", cycle: "fetch", colors: ["W", "U"], entersTapped: false },
  { name: "Marsh Flats", cycle: "fetch", colors: ["W", "B"], entersTapped: false },
  { name: "Misty Rainforest", cycle: "fetch", colors: ["U", "G"], entersTapped: false },
  { name: "Polluted Delta", cycle: "fetch", colors: ["U", "B"], entersTapped: false },
  { name: "Scalding Tarn", cycle: "fetch", colors: ["U", "R"], entersTapped: false },
  { name: "Verdant Catacombs", cycle: "fetch", colors: ["B", "G"], entersTapped: false },
  { name: "Windswept Heath", cycle: "fetch", colors: ["G", "W"], entersTapped: false },
  { name: "Wooded Foothills", cycle: "fetch", colors: ["R", "G"], entersTapped: false },
  { name: "Prismatic Vista", cycle: "fetch", colors: [], entersTapped: false },

  // Shock lands (Ravnica) — entram destapados pagando 2 de vida.
  { name: "Blood Crypt", cycle: "shock", colors: ["B", "R"], entersTapped: false },
  { name: "Breeding Pool", cycle: "shock", colors: ["U", "G"], entersTapped: false },
  { name: "Godless Shrine", cycle: "shock", colors: ["W", "B"], entersTapped: false },
  { name: "Hallowed Fountain", cycle: "shock", colors: ["W", "U"], entersTapped: false },
  { name: "Overgrown Tomb", cycle: "shock", colors: ["B", "G"], entersTapped: false },
  { name: "Sacred Foundry", cycle: "shock", colors: ["R", "W"], entersTapped: false },
  { name: "Steam Vents", cycle: "shock", colors: ["U", "R"], entersTapped: false },
  { name: "Stomping Ground", cycle: "shock", colors: ["R", "G"], entersTapped: false },
  { name: "Temple Garden", cycle: "shock", colors: ["G", "W"], entersTapped: false },
  { name: "Watery Grave", cycle: "shock", colors: ["U", "B"], entersTapped: false },

  // Pain lands (Apocalypse/Odyssey) — sempre destapadas, dano por mana colorida.
  { name: "Adarkar Wastes", cycle: "pain", colors: ["W", "U"], entersTapped: false },
  { name: "Battlefield Forge", cycle: "pain", colors: ["R", "W"], entersTapped: false },
  { name: "Brushland", cycle: "pain", colors: ["G", "W"], entersTapped: false },
  { name: "Caves of Koilos", cycle: "pain", colors: ["W", "B"], entersTapped: false },
  { name: "Karplusan Forest", cycle: "pain", colors: ["R", "G"], entersTapped: false },
  { name: "Llanowar Wastes", cycle: "pain", colors: ["B", "G"], entersTapped: false },
  { name: "Shivan Reef", cycle: "pain", colors: ["U", "R"], entersTapped: false },
  { name: "Sulfurous Springs", cycle: "pain", colors: ["B", "R"], entersTapped: false },
  { name: "Underground River", cycle: "pain", colors: ["U", "B"], entersTapped: false },
  { name: "Yavimaya Coast", cycle: "pain", colors: ["U", "G"], entersTapped: false },

  // Qualquer cor — clássicos de Commander.
  { name: "Command Tower", cycle: "anycolor", colors: [], entersTapped: false },
  { name: "Exotic Orchard", cycle: "anycolor", colors: [], entersTapped: false },
  { name: "City of Brass", cycle: "anycolor", colors: [], entersTapped: false },
  { name: "Mana Confluence", cycle: "anycolor", colors: [], entersTapped: false },
  { name: "Path of Ancestry", cycle: "anycolor", colors: [], entersTapped: true },
];

function isSubsetOfIdentity(colors: ManaColor[], identity: ManaColor[]): boolean {
  return colors.every((c) => identity.includes(c));
}

/**
 * Filtra a base curada pela identidade de cor do deck, descartando terrenos
 * que o usuário já tem na lista. Terrenos de ciclo (fetch/shock/pain) só
 * entram se TODAS as cores que produzem estiverem na identidade — regra de
 * legalidade do Commander, não só relevância. Ordena terrenos que entram
 * destapados primeiro (despriorizando, não excluindo, os que entram virados).
 */
export function suggestLands(identity: ManaColor[], ownedNames: Set<string>): LandCycleEntry[] {
  return LAND_DATABASE.filter((land) => {
    if (ownedNames.has(land.name.toLowerCase())) return false;
    if (land.colors.length === 0) return true; // qualquer cor: sempre relevante
    return land.colors.length >= 2 && isSubsetOfIdentity(land.colors, identity);
  }).sort((a, b) => Number(a.entersTapped) - Number(b.entersTapped));
}
