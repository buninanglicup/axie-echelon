// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes. Route paths are unchanged (/api/axie/:id,
// /api/axie-detail/:id, /api/address/:address), so the frontend requires no
// changes for this split.
//
// TASK E (2026-09): refactored into a createAxieRouter(...) factory,
// mirroring profileRoutes.js, so tests can inject fakes for the upstream
// GraphQL/Fighters calls instead of hitting real dependencies or reaching
// for module-mocking (which nothing else in this repo uses).
import express from "express";
import { cleanAxieId, cleanRoninAddress } from "./shared/validators.js";
import { getAxieMarketplaceDetails, fetchAxiesOwnedByAddress } from "./shared/marketplaceAxieClient.js";
import { getProfileByRoninAddress } from "./shared/profileClient.js";
import { resolveAxieById, getAllUserFighters, normalizeFighter, classifyCollectible } from "./axieService.js";
import { getCachedAddressLookup, setCachedAddressLookup } from "./shared/addressLookupCache.js";
import { expensiveRouteLimiter } from "./shared/rateLimiters.js";

export function createAxieRouter({
  resolveAxieById: resolveAxieByIdDep,
  getAxieMarketplaceDetails: getAxieMarketplaceDetailsDep,
  getProfileByRoninAddress: getProfileByRoninAddressDep,
  fetchAxiesOwnedByAddress: fetchAxiesOwnedByAddressDep,
  getAllUserFighters: getAllUserFightersDep,
  normalizeFighter: normalizeFighterDep,
  classifyCollectible: classifyCollectibleDep
}) {
  const router = express.Router();

  router.get("/api/axie/:id", async (request, response) => {
    try {
      const axieId = cleanAxieId(request.params.id);
      console.log("AXIE ROUTE HIT", axieId, "mode=api/axie");
      const axie = await resolveAxieByIdDep(axieId);

      response.json({ axie });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.get("/api/axie-detail/:id", async (request, response) => {
    try {
      const axieId = cleanAxieId(request.params.id);
      const axie = await getAxieMarketplaceDetailsDep(axieId);

      response.json({ axie });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.get("/api/address/:address", expensiveRouteLimiter, async (request, response) => {
    try {
      const address = cleanRoninAddress(request.params.address);
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(request.query.limit) || 30));

      let result = getCachedAddressLookup(address);

      if (!result) {
        console.log(`[/api/address] CALL: address=${address}`);

        const profile = await getProfileByRoninAddressDep(address);
        console.log(`[/api/address] Profile resolved: accountId=${profile.accountId}, name=${profile.name}`);

        const ownedAxies = await fetchAxiesOwnedByAddressDep(address);
        let fighterItems = ownedAxies.items;
        let totalItems = ownedAxies.total;

        const fighters = await getAllUserFightersDep(profile.accountId);
        const fightersById = new Map(
          (fighters.items || [])
            .filter((fighter) => fighter?.id != null)
            .map((fighter) => [String(fighter.id), fighter])
        );

        if (fighterItems.length > 0) {
          fighterItems = fighterItems.map((axie) => {
            const fighter = fightersById.get(String(axie.id));
            return fighter ? { ...axie, ...fighter } : axie;
          });
          console.log(`[/api/address] Using GraphQL marketplace results with Fighters API enrichment for ${fighterItems.length} Axies`);
        } else {
          fighterItems = fighters.items;
          totalItems = fighters.totalItems;
          console.log(`[/api/address] GraphQL marketplace returned no Axies; using fighter endpoint fallback with ${fighterItems.length} Axies`);
        }

        console.log(`[/api/address] Total fighters available: ${totalItems}`);
        console.log(`[/api/address] Got ${fighterItems.length} fighters for client-side filtering and pagination`);

        const uniqueAxies = new Map();
        let processedCount = 0;
        let errorCount = 0;

        for (const fighter of fighterItems) {
          try {
            let normalized = normalizeFighterDep(fighter, address, profile.accountId);
            normalized = classifyCollectibleDep(fighter, normalized);

            if (!normalized || !normalized.id) {
              console.error(`[/api/address] Fighter has missing id after normalize. Fighter:`, JSON.stringify(fighter).slice(0, 200));
              errorCount++;
              continue;
            }

            uniqueAxies.set(normalized.id, normalized);
            processedCount++;
          } catch (err) {
            console.error(`[/api/address] Error processing fighter:`, err && err.message ? err.message : err);
            errorCount++;
          }
        }

        console.log(`[/api/address] Processed ${processedCount} fighters, ${errorCount} errors. Returning ${uniqueAxies.size} axies.`);

        result = {
          profile,
          axies: [...uniqueAxies.values()],
          morphDataNotice: ownedAxies.items.length > 0 && fighters.items.length === 0
            ? "This address has Axies, but morph data is unavailable for this wallet. Search an individual Axie ID to retrieve its latest morph data."
            : null,
          totalItems
        };

        setCachedAddressLookup(address, result);
      } else {
        console.log(`[/api/address] CACHE HIT: address=${address}`);
      }

      response.json({
        ...result,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(result.totalItems / pageSize))
      });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  return router;
}

export default createAxieRouter({
  resolveAxieById,
  getAxieMarketplaceDetails,
  getProfileByRoninAddress,
  fetchAxiesOwnedByAddress,
  getAllUserFighters,
  normalizeFighter,
  classifyCollectible
});