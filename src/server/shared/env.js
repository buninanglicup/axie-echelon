import dotenv from "dotenv";

dotenv.config();

export const DEBUG_ON = (process.env.DEBUG_ON || "false").toLowerCase() === "true";
export const requestedPort = Number(process.env.PORT || 8787);
export const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 8787;
export const allowedOrigin = process.env.CORS_ORIGIN || "http://127.0.0.1:5173";
export const AXIE_ECHELON_API_KEY = process.env.AXIE_ECHELON_API_KEY;
export const MAVIS_API_URL = process.env.MAVIS_API_URL || "https://api-gateway.skymavis.com";
export const GRAPHQL_URL = process.env.GRAPHQL_URL || "https://graphql-gateway.axieinfinity.com/graphql";
export const GRAPHQL_UPDATED_URL = process.env.GRAPHQL_UPDATED_URL || "https://api-gateway.skymavis.com/graphql/axie-marketplace";
export const PROFILE_BASE = "https://app.axieinfinity.com/profile";
export const USE_TEST_ACCOUNT = (process.env.USE_TEST_ACCOUNT || "false").toLowerCase() === "true";
export const TEST_ACCOUNT_ID = "1ec9eb6f-4702-677d-a60c-5b43771e8057";
export const TEST_OWNER_ADDRESS = "0xf7fa15bc10b1e55d1a3632ae80aae36c520dce01";
export const LIVE_ACCOUNT_ID = process.env.ACCOUNT_ID || "";
export const LIVE_OWNER_ADDRESS = process.env.OWNER_ADDRESS || "";