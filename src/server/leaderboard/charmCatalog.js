import charmResponse from "../../data/charms.json" with { type: "json" };

// Generated catalog boundary for both live profile logs and archived snapshots.
// Unknown IDs intentionally preserve their ID upstream instead of becoming a
// misleading named/image asset in the UI.

export const charmRegistry = Object.fromEntries(
  (Array.isArray(charmResponse?._items) ? charmResponse._items : []).map((entry) => {
    const item = entry.item || {};
    return [entry.id, {
      id: entry.id,
      name: item.name || entry.id,
      description: item.description || null,
      imageUrl: item.imageUrl || null,
      rarity: item.rarity || null,
      class: entry.class || null
    }];
  })
);

export function getCharmMetadata(charmId) {
  return charmRegistry[charmId] || null;
}
