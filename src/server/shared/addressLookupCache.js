import { cleanRoninAddress } from "./validators.js";

export const ADDRESS_LOOKUP_CACHE_TTL_MS = Number(process.env.ADDRESS_LOOKUP_CACHE_TTL_MS || 300000); // 5 minutes default

export const addressLookupCache = new Map();

export function getCachedAddressLookup(address) {
  const key = cleanRoninAddress(address);
  const cached = addressLookupCache.get(key);

  if (!cached) return null;

  if (Date.now() - cached.timestamp > ADDRESS_LOOKUP_CACHE_TTL_MS) {
    addressLookupCache.delete(key);
    return null;
  }

  return {
    profile: cached.profile ?? null,
    axies: Array.isArray(cached.axies) ? [...cached.axies] : [],
    morphDataNotice: cached.morphDataNotice ?? null,
    totalItems: Number(cached.totalItems ?? cached.axies?.length ?? 0),
    page: Number(cached.page ?? 1),
    pageSize: Number(cached.pageSize ?? 30),
    totalPages: Number(cached.totalPages ?? 1),
    timestamp: cached.timestamp
  };
}

export function setCachedAddressLookup(address, payload) {
  const key = cleanRoninAddress(address);
  const axies = Array.isArray(payload?.axies) ? payload.axies : [];
  const totalItems = Number(payload?.totalItems ?? axies.length);
  const page = Number(payload?.page ?? 1);
  const pageSize = Number(payload?.pageSize ?? 30);

  const normalized = {
    profile: payload?.profile ?? null,
    axies,
    morphDataNotice: payload?.morphDataNotice ?? null,
    totalItems,
    page,
    pageSize,
    totalPages: Number(payload?.totalPages ?? Math.max(1, Math.ceil(totalItems / (pageSize || 1)))),
    timestamp: Date.now()
  };

  addressLookupCache.set(key, normalized);
  return normalized;
}
