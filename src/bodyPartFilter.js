import { decodeGenes } from "./geneDecoder.js";
import { getBodyPartMapping, matchBodyPartName } from "./bodyPartMapper.js";

function getGenes(fighter) {
  return fighter?.genes_metamorph || fighter?.genesMetamorph || fighter?.genes;
}

export function decodeFighterBodyParts(fighter) {
  const decoded = decodeGenes(getGenes(fighter));
  if (!decoded) return null;

  return Object.entries(decoded.parts || {}).map(([slot, part]) => ({
    slot,
    ...part.dominant,
    mapping: getBodyPartMapping({ ...part.dominant, slot })
  }));
}

export function fighterMatchesBodyParts(fighter, selectedNames) {
  const names = Array.isArray(selectedNames)
    ? selectedNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  if (names.length === 0) return { matched: true, known: true, parts: [] };

  const parts = decodeFighterBodyParts(fighter);
  if (!parts) return { matched: false, known: false, parts: [] };

  const matchedParts = parts.filter((part) =>
    names.some((name) => matchBodyPartName(part, name))
  );
  return {
    matched: matchedParts.length > 0,
    known: true,
    parts: matchedParts
  };
}

export default { decodeFighterBodyParts, fighterMatchesBodyParts };
