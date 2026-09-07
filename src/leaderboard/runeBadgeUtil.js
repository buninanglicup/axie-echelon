export function formatRuneBadgeLabel(rune) {
  if (!rune) return "";
  const rawId = rune.id ?? "";
  const id = rawId == null ? "" : String(rawId);
  const name = rune.name ?? null;
  if (name) return id ? `${name} (${id})` : name;
  return id;
}

export function coerceCompatibleRune(fighter) {
  if (!fighter) return null;

  const candidate = fighter.rune || ((Array.isArray(fighter.runes) && fighter.runes.length > 0) ? fighter.runes[0] : null);
  if (!candidate) return null;

  if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') {
    return { id: String(candidate), name: null, imageUrl: null };
  }

  if (Array.isArray(candidate)) {
    return coerceCompatibleRune({ runes: candidate });
  }

  if (typeof candidate === 'object') {
    const id = candidate.id ?? candidate.runeId ?? candidate.runeID ?? candidate.rune ?? null;
    if (!id) return null;
    return {
      id: String(id),
      name: typeof candidate.name === 'string' && candidate.name ? candidate.name : null,
      imageUrl: candidate.imageUrl || candidate.image_url || null
    };
  }

  return null;
}
