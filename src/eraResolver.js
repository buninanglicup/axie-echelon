import seasonConfig from "./data/season.json" with { type: "json" };

function validateSeasonConfig(config) {
  const errors = [];

  if (!Number.isInteger(config.seasonId) || config.seasonId <= 0) {
    errors.push("seasonId must be a positive integer.");
  }
  if (typeof config.seasonName !== "string" || !config.seasonName.trim()) {
    errors.push("seasonName must be a non-empty string.");
  }
  if (!Number.isFinite(config.seasonStartedAt) || config.seasonStartedAt <= 0) {
    errors.push("seasonStartedAt must be a positive Unix timestamp (seconds).");
  }
  if (
    config.seasonEndedAt !== undefined &&
    (!Number.isFinite(config.seasonEndedAt) || config.seasonEndedAt <= config.seasonStartedAt)
  ) {
    errors.push("seasonEndedAt, if provided, must be after seasonStartedAt.");
  }
  if (
    !Array.isArray(config.eraDurationDays) ||
    config.eraDurationDays.length !== 4 ||
    !config.eraDurationDays.every((days) => Number.isFinite(days) && days > 0)
  ) {
    errors.push("eraDurationDays must contain exactly 4 positive numbers.");
  }
  if (
    config.eraNames !== undefined &&
    (!Array.isArray(config.eraNames) ||
      config.eraNames.length !== 4 ||
      !config.eraNames.every((name) => typeof name === "string" && name.trim()))
  ) {
    errors.push("eraNames, if provided, must contain exactly 4 non-empty strings.");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid src/data/season.json:\n  - ${errors.join("\n  - ")}`);
  }
}

validateSeasonConfig(seasonConfig);

const DAY_MS = 24 * 60 * 60 * 1000;

function getEraBoundaries() {
  const seasonStartedAtMs = seasonConfig.seasonStartedAt * 1000;
  const seasonEndedAtMs = seasonConfig.seasonEndedAt
    ? seasonConfig.seasonEndedAt * 1000
    : seasonStartedAtMs + seasonConfig.eraDurationDays.reduce((total, days) => total + days, 0) * DAY_MS;
  const durationsMs = seasonConfig.eraDurationDays.map((days) => days * DAY_MS);
  const boundaries = Array(durationsMs.length).fill(null);
  let cursorMs = seasonEndedAtMs;

  for (let index = durationsMs.length - 1; index >= 0; index -= 1) {
    const endMs = cursorMs;
    const startMs = endMs - durationsMs[index];
    boundaries[index] = { startMs, endMs };
    cursorMs = startMs;
  }

  // A maintenance delay may shift the first era's actual start. The config's
  // seasonStartedAt is authoritative for Rare even when backward calculation
  // produces an earlier nominal boundary.
  boundaries[0].startMs = seasonStartedAtMs;
  return boundaries;
}

// Resolve the current era within the season declared in season.json. The
// returned milestone is the numeric value Sky Mavis expects for its API.
export function getCurrentEraForConfiguredSeason(now = Date.now()) {
  const seasonStartedAtMs = seasonConfig.seasonStartedAt * 1000;
  const seasonEndedAtMs = seasonConfig.seasonEndedAt ? seasonConfig.seasonEndedAt * 1000 : null;
  const boundaries = getEraBoundaries();

  if (seasonEndedAtMs !== null && now >= seasonEndedAtMs) {
    return {
      seasonId: seasonConfig.seasonId,
      seasonName: seasonConfig.seasonName,
      offSeasonMode: true,
      milestone: null,
      eraName: "Offseason",
      seasonStartedAt: seasonConfig.seasonStartedAt,
      seasonEndedAt: seasonConfig.seasonEndedAt,
      eraIndex: null,
      eraStartedAt: Math.floor(seasonEndedAtMs / 1000),
      eraEndsAt: null
    };
  }

  let eraIndex = 0;
  let eraStartedAtMs = boundaries[0].startMs;
  let eraEndsAtMs = boundaries[0].endMs;

  if (now >= seasonStartedAtMs) {
    eraIndex = boundaries.length - 1;
    for (let index = 0; index < boundaries.length; index += 1) {
      if (now < boundaries[index].endMs) {
        eraIndex = index;
        break;
      }
    }
    eraStartedAtMs = boundaries[eraIndex].startMs;
    eraEndsAtMs = boundaries[eraIndex].endMs;
  }

  const milestone = eraIndex + 1;

  return {
    seasonId: seasonConfig.seasonId,
    seasonName: seasonConfig.seasonName,
    offSeasonMode: false,
    seasonStartedAt: seasonConfig.seasonStartedAt,
    seasonEndedAt: seasonConfig.seasonEndedAt ?? null,
    eraIndex,
    milestone,
    eraName: seasonConfig.eraNames?.[eraIndex] || `Era ${milestone}`,
    eraStartedAt: Math.floor(eraStartedAtMs / 1000),
    eraEndsAt: Math.floor(eraEndsAtMs / 1000)
  };
}

export { getEraBoundaries };
