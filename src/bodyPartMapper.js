import mappingData from "./data/body-part-mapping-candidate.json" with { type: "json" };

const mappings = new Map(
  mappingData.mappings.map((mapping) => [
    `${mapping.class}:${mapping.slot}:${mapping.partValue}`,
    mapping
  ])
);

function keyFor(part) {
  if (!part || !part.class || !part.slot || !Number.isInteger(part.id)) return null;
  return `${String(part.class).toLowerCase()}:${String(part.slot).toLowerCase()}:${part.id}`;
}

export function getBodyPartMapping(part) {
  const key = keyFor(part);
  return key ? mappings.get(key) || null : null;
}

export function getBodyPartNames(part) {
  const mapping = getBodyPartMapping(part);
  if (!mapping) return [];
  return [mapping.canonicalName, ...(mapping.variants || []).map((variant) => variant.name)]
    .filter(Boolean);
}

export function matchBodyPartName(part, requestedName) {
  const normalizedRequestedName = String(requestedName || "").trim().toLowerCase();
  if (!normalizedRequestedName) return false;
  return getBodyPartNames(part).some((name) => name.toLowerCase() === normalizedRequestedName);
}

export default { getBodyPartMapping, getBodyPartNames, matchBodyPartName };
