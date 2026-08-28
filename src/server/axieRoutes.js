// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes. Route paths are unchanged (/api/axie/:id,
// /api/axie-detail/:id, /api/address/:address), so the frontend requires no
// changes for this split.
import express from "express";
import { cleanAxieId, cleanRoninAddress } from "./shared/validators.js";
import { getAxieMarketplaceDetails, fetchAxiesOwnedByAddress } from "./shared/marketplaceAxieClient.js";
import { getProfileByRoninAddress } from "./shared/profileClient.js";
import { resolveAxieById, getAllUserFighters, normalizeFighter, classifyCollectible } from "./axieService.js";

const router = express.Router();

router.get("/api/axie/:id", async (request, response) => {
  try {
    const axieId = cleanAxieId(request.params.id);
    console.log("AXIE ROUTE HIT", axieId, "mode=api/axie");
    const axie = await resolveAxieById(axieId);

    response.json({ axie });
  } catch (error) {
    response.status(400).json({
      error: error.message
    });
  }
});

router.get("/api/axie-detail/:id", async (request, response) => {
  try {
    const axieId = cleanAxieId(request.params.id);
    const axie = await getAxieMarketplaceDetails(axieId);

    response.json({ axie });
  } catch (error) {
    response.status(400).json({
      error: error.message
    });
  }
});

router.get("/api/address/:address", async (request, response) => {
  try {
    const address = cleanRoninAddress(request.params.address);
    console.log(`[/api/address] CALL: address=${address}`);

    const profile = await getProfileByRoninAddress(address);
    console.log(`[/api/address] Profile resolved: accountId=${profile.accountId}, name=${profile.name}`);

    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.max(1, Number(request.query.limit) || 30);

    const ownedAxies = await fetchAxiesOwnedByAddress(address);
    let fighterItems = ownedAxies.items;
    let totalItems = ownedAxies.total;

    // Keep the complete Marketplace inventory and enrich matching IDs with the
    // Fighters API record, which supplies genesMetamorph and morphable parts.
    const fighters = await getAllUserFighters(profile.accountId);
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
      // Preserve the historical fallback when Marketplace inventory is empty.
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
        let normalized = normalizeFighter(
          fighter,
          address,
          profile.accountId
        );

        // apply collectible classifier heuristics
        normalized = classifyCollectible(fighter, normalized);

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

    response.json({
      profile,
      axies: [...uniqueAxies.values()],
      morphDataNotice: ownedAxies.items.length > 0 && fighters.items.length === 0
        ? "This address has Axies, but morph data is unavailable for this wallet. Search an individual Axie ID to retrieve its latest morph data."
        : null,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      totalItems
    });
  } catch (error) {
    response.status(400).json({
      error: error.message
    });
  }
});

export default router;
