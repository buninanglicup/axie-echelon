// Resolves the full config bundle for a tracker: which Axie account to
// track, which ports the backend/frontend run on, the CORS origin, the
// API key, and the frontend leaderboard/polling settings.
//
// This is the single source both env.js (Node server) and vite.config.js
// (frontend dev server) read from, so a profile is defined once and both
// runtimes pick it up consistently.
//
// Default behavior (no TRACKER_PROFILE_* vars set) is unchanged from
// before this file existed: a single implicit profile built from the
// existing unprefixed vars (ACCOUNT_ID, PORT, CORS_ORIGIN, etc).
//
// To add more profiles, define them with indexed env vars in .env, e.g.:
//
//   TRACKER_PROFILE_2_MAVIS_API_KEY=...         (optional, needed for live API calls)
//   TRACKER_PROFILE_2_VITE_LEADERBOARD_LIMIT=35 (optional)
//   TRACKER_PROFILE_2_VITE_LEADERBOARD_OFFSET=0 (optional)
//   TRACKER_PROFILE_2_VITE_POLLING_INTERVAL=30  (optional)
//   TRACKER_PROFILE_2_DEBUG_ON=true             (optional)
//
// PORT, VITE_PORT, and CORS_ORIGIN are deliberately NOT in that list --
// don't set them manually unless you want a specific override. If omitted,
// they're derived from the profile's index so profiles never collide
// with each other or with the default profile:
//
//   port      = 8787 + (index - 1) * 10   (profile 2 -> 8797, 3 -> 8807, ...)
//   vitePort  = 5173 + (index - 1) * 10   (profile 2 -> 5183, 3 -> 5193, ...)
//   corsOrigin = http://127.0.0.1:<derived vitePort>
//
// These are the only fields that get an index-derived default instead of
// a flat one. Every other optional field is safe to repeat the same
// value across profiles -- these three are the only ones where a flat
// default (e.g. "always fall back to 8787") would silently collide
// between profiles, since ports are the one thing here that actually
// has to be unique per running process. You can still override any of
// the three per profile with TRACKER_PROFILE_N_PORT / _VITE_PORT /
// _CORS_ORIGIN if you want specific values instead of the derived ones.
//
// Numbering must start at 2 and be contiguous; resolution stops at the
// first missing index. Profile "1" is always the default profile, built
// from the plain unprefixed vars -- it doesn't need indexed vars.
//
// Select the active profile for a given run with:
//
//   TRACKER_PROFILE=2
//
// Leaving TRACKER_PROFILE unset uses the default profile.
//
// NOTE ON MAVIS_API_KEY: the codebase's existing single-profile key is
// named AXIE_ECHELON_API_KEY (see env.js). This file treats
// TRACKER_PROFILE_N_MAVIS_API_KEY as the per-profile equivalent of that
// same key -- adjust the env var name below if that assumption is wrong
// for your setup.
//
// IMPORTANT: none of the exported functions read process.env at module
// top level -- only inside function bodies. env.js imports this module
// before calling dotenv.config(), and vite.config.js's own top-level code
// runs before its call site reads process.env too. Reading lazily, inside
// functions that are only *called* once the caller is ready, avoids
// depending on import order in either runtime. Keep it that way if you
// edit this file.

const DEFAULT_PORT_BASE = 8787;
const DEFAULT_VITE_PORT_BASE = 5173;
const PORT_STEP = 10;

function deriveDefaultPort(index) {
  return DEFAULT_PORT_BASE + (index - 1) * PORT_STEP;
}

function deriveDefaultVitePort(index) {
  return DEFAULT_VITE_PORT_BASE + (index - 1) * PORT_STEP;
}

function toBool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildDefaultProfile() {
  return {
    id: "1",
    accountId: process.env.ACCOUNT_ID || "",
    ownerAddress: process.env.OWNER_ADDRESS || "",
    apiKey: process.env.AXIE_ECHELON_API_KEY || "",
    port: toNumber(process.env.PORT, DEFAULT_PORT_BASE),
    vitePort: toNumber(process.env.VITE_PORT, DEFAULT_VITE_PORT_BASE),
    corsOrigin: process.env.CORS_ORIGIN || "http://127.0.0.1:5173",
    viteLeaderboardLimit: toNumber(process.env.VITE_LEADERBOARD_LIMIT, 50),
    viteLeaderboardOffset: toNumber(process.env.VITE_LEADERBOARD_OFFSET, 0),
    vitePollingInterval: toNumber(process.env.VITE_POLLING_INTERVAL, 30),
    debugOn: toBool(process.env.DEBUG_ON, false)
  };
}

function buildIndexedProfile(index) {
  const prefix = `TRACKER_PROFILE_${index}_`;
  const hasAnyTrackerConfig =
    !!process.env[`${prefix}MAVIS_API_KEY`] ||
    !!process.env[`${prefix}PORT`] ||
    !!process.env[`${prefix}VITE_PORT`] ||
    !!process.env[`${prefix}CORS_ORIGIN`] ||
    !!process.env[`${prefix}VITE_LEADERBOARD_LIMIT`] ||
    !!process.env[`${prefix}VITE_LEADERBOARD_OFFSET`] ||
    !!process.env[`${prefix}VITE_POLLING_INTERVAL`] ||
    !!process.env[`${prefix}DEBUG_ON`] ||
    !!process.env[`${prefix}ACCOUNT_ID`] ||
    !!process.env[`${prefix}OWNER_ADDRESS`];

  // Indexed profiles are valid when they carry any tracker-specific config,
  // even if they are only being used for local multi-instance testing.
  // This intentionally does not require ACCOUNT_ID / OWNER_ADDRESS anymore.
  if (!hasAnyTrackerConfig) return null;

  // vitePort is computed first since corsOrigin's default depends on it.
  const vitePort = toNumber(process.env[`${prefix}VITE_PORT`], deriveDefaultVitePort(index));

  const accountId = process.env[`${prefix}ACCOUNT_ID`] || "";
  const ownerAddress = process.env[`${prefix}OWNER_ADDRESS`] || "";

  return {
    id: String(index),
    accountId: accountId || "",
    ownerAddress: ownerAddress || "",
    apiKey: process.env[`${prefix}MAVIS_API_KEY`] || "",
    port: toNumber(process.env[`${prefix}PORT`], deriveDefaultPort(index)),
    vitePort,
    corsOrigin: process.env[`${prefix}CORS_ORIGIN`] || `http://127.0.0.1:${vitePort}`,
    viteLeaderboardLimit: toNumber(process.env[`${prefix}VITE_LEADERBOARD_LIMIT`], 50),
    viteLeaderboardOffset: toNumber(process.env[`${prefix}VITE_LEADERBOARD_OFFSET`], 0),
    vitePollingInterval: toNumber(process.env[`${prefix}VITE_POLLING_INTERVAL`], 30),
    debugOn: toBool(process.env[`${prefix}DEBUG_ON`], false)
  };
}

// Returns every configured profile. Profile "1" (default) is always
// present. Additional profiles are picked up starting at index 2,
// stopping at the first gap.
export function resolveTrackerProfiles() {
  const profiles = [buildDefaultProfile()];

  let index = 2;
  let next = buildIndexedProfile(index);
  while (next) {
    profiles.push(next);
    index += 1;
    next = buildIndexedProfile(index);
  }

  return profiles;
}

// Returns the single profile that should be active for this run, based
// on TRACKER_PROFILE (matched against its numeric id). Falls back to the
// default profile if TRACKER_PROFILE is unset or doesn't match anything configured.
export function resolveActiveProfile() {
  const profiles = resolveTrackerProfiles();
  const requested = (process.env.TRACKER_PROFILE || "").trim();

  if (!requested || requested === "1" || requested.toLowerCase() === "default") {
    return profiles[0];
  }

  const match = profiles.find((profile) => profile.id === requested);

  if (match) return match;

  console.warn(
    `[trackerProfiles] TRACKER_PROFILE="${requested}" did not match any configured profile ` +
      `(known: ${profiles.map((p) => p.id).join(", ")}). Falling back to the default profile.`
  );
  return profiles[0];
}