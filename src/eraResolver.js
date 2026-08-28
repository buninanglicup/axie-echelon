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

// Resolve the current era within the season declared in season.json. The
// returned milestone is the numeric value Sky Mavis expects for its API.
export function getCurrentEraForConfiguredSeason(now = Date.now()) {
  const seasonStartedAtMs = seasonConfig.seasonStartedAt * 1000;
  const eraDurationsMs = seasonConfig.eraDurationDays.map((days) => days * DAY_MS);
  let eraIndex = 0;
  let eraStartedAtMs = seasonStartedAtMs;

  if (now >= seasonStartedAtMs) {
    let cursorMs = seasonStartedAtMs;
    eraIndex = eraDurationsMs.length - 1;
    eraStartedAtMs = cursorMs;

    for (let index = 0; index < eraDurationsMs.length; index += 1) {
      if (now < cursorMs + eraDurationsMs[index]) {
        eraIndex = index;
        eraStartedAtMs = cursorMs;
        break;
      }
      cursorMs += eraDurationsMs[index];
      eraStartedAtMs = cursorMs;
    }
  }

  const eraEndsAtMs = eraStartedAtMs + eraDurationsMs[eraIndex];
  const milestone = eraIndex + 1;

  return {
    seasonId: seasonConfig.seasonId,
    seasonName: seasonConfig.seasonName,
    seasonStartedAt: seasonConfig.seasonStartedAt,
    seasonEndedAt: seasonConfig.seasonEndedAt ?? null,
    eraIndex,
    milestone,
    eraName: seasonConfig.eraNames?.[eraIndex] || `Era ${milestone}`,
    eraStartedAt: Math.floor(eraStartedAtMs / 1000),
    eraEndsAt: Math.floor(eraEndsAtMs / 1000)
  };
}
