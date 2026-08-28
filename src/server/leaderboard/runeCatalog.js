import runeResponse from "../../data/runes.json" with { type: "json" };

export const runeRegistry = Object.fromEntries(
  (Array.isArray(runeResponse?._items) ? runeResponse._items : []).map((entry) => {
    const item = entry.item || {};
    return [entry.id, {
      id: entry.id,
      name: item.name || entry.rune || entry.id,
      imageUrl: item.imageUrl || null,
      class: entry.class || null
    }];
  })
);

export function getRuneMetadata(runeId) {
  return runeRegistry[runeId] || null;
}