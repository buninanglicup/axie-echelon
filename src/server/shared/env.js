import dotenv from "dotenv";
import { resolveActiveProfile } from "./trackerProfiles.js";

dotenv.config();

// Active profile is resolved once, at import time, same as every other
// constant in this file -- this preserves the existing "env.js exports
// stable singleton values for the life of the process" behavior. Switching
// profiles means restarting the process with a different TRACKER_PROFILE,
// not changing it mid-run. See trackerProfiles.js for how profiles are
// defined and selected, and for the fields not listed below (frontend
// ports/settings) that vite.config.js reads from the same profile.
const activeProfile = resolveActiveProfile();

export const DEBUG_ON = activeProfile.debugOn;
if (DEBUG_ON) {
  console.log(`[env] Active tracker profile: ${activeProfile.id}`);
}

export const requestedPort = activeProfile.port;
export const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 8787;
export const allowedOrigin = activeProfile.corsOrigin;
export const AXIE_ECHELON_API_KEY = activeProfile.apiKey;
export const MAVIS_API_URL = process.env.MAVIS_API_URL || "https://api-gateway.skymavis.com";
export const GRAPHQL_URL = process.env.GRAPHQL_URL || "https://graphql-gateway.axieinfinity.com/graphql";
export const GRAPHQL_UPDATED_URL = process.env.GRAPHQL_UPDATED_URL || "https://api-gateway.skymavis.com/graphql/axie-marketplace";
export const PROFILE_BASE = "https://app.axieinfinity.com/profile";
export const USE_TEST_ACCOUNT = (process.env.USE_TEST_ACCOUNT || "false").toLowerCase() === "true";
export const TEST_ACCOUNT_ID = "1ec9eb6f-4702-677d-a60c-5b43771e8057";
export const TEST_OWNER_ADDRESS = "0xf7fa15bc10b1e55d1a3632ae80aae36c520dce01";

export const ACTIVE_TRACKER_PROFILE = activeProfile.id;
