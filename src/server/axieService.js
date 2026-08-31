// PHASE 1 FILE SPLIT (2026-08-19) -- moved verbatim from the old server.js,
// no logic changes. This file holds everything specific to the "look up an
// Axie by ID or by Ronin wallet address" feature -- a genuinely separate
// feature from the leaderboard that happened to live in the same file
// before this split. See src/server/leaderboard/* for the leaderboard
// feature; see src/server/shared/* for code both features depend on
// (GraphQL client, profile resolution, validators, env config).
import {
  AXIE_ECHELON_API_KEY,
  MAVIS_API_URL,
  USE_TEST_ACCOUNT,
  TEST_ACCOUNT_ID,
  TEST_OWNER_ADDRESS,
  LIVE_ACCOUNT_ID,
  LIVE_OWNER_ADDRESS
} from "./shared/env.js";
import { cleanRoninAddress } from "./shared/validators.js";
import {
  getAxieOwnershipDetails,
  getAxieMarketplaceDetails
} from "./shared/marketplaceAxieClient.js";
import { getProfileByRoninAddress } from "./shared/profileClient.js";
import geneDecoder from "../geneDecoder.js";

export async function getUserFighters(accountId, options = {}) {
  if (!AXIE_ECHELON_API_KEY) {
    throw new Error("AXIE_ECHELON_API_KEY is missing from .env.");
  }

  const pageSize = Math.max(1, Number(options.limit) || 100);
  const page = Math.max(1, Number(options.page) || 1);
  const offset = (page - 1) * pageSize;

  const url = new URL(
    `${MAVIS_API_URL}/origins/v2/community/users/fighters`
  );

  url.searchParams.set("userID", accountId);
  url.searchParams.set("axieType", "ronin");
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("offset", String(offset));

  console.log(`[getUserFighters] CALL: accountId=${accountId}, page=${page}, pageSize=${pageSize}, offset=${offset}`);

  const response = await fetch(url, {
    headers: {
      "X-API-Key": AXIE_ECHELON_API_KEY
    }
  });

  const text = await response.text();

  if (!response.ok) {
    console.error(`[getUserFighters] API ERROR: HTTP ${response.status}. accountId=${accountId}. Response:`, text.slice(0, 300));
    throw new Error(
      `Fighters API HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Fighters API returned invalid JSON.");
  }

  if (json._errorStatus || json._errorMessage) {
    const errorMessage = json._errorMessage || json._errorStatus;
    console.error(`[getUserFighters] API RESPONSE ERROR: accountId=${accountId}. ${errorMessage}`);
    throw new Error(`Fighters API error: ${errorMessage}`);
  }

  const items = Array.isArray(json._items) ? json._items : [];

  console.log(`[getUserFighters] SUCCESS: accountId=${accountId}, page=${page}, itemsReturned=${items.length}, totalItems=${Number(json._metadata?.total || json.total) || items.length}`);

  return {
    items,
    page,
    pageSize,
    totalItems: Number(json._metadata?.total || json.total) || items.length
  };
}

export async function getAllUserFighters(accountId) {
  const firstPage = await getUserFighters(accountId, { page: 1, limit: 100 });
  const items = [...firstPage.items];
  let page = 2;

  while (items.length < firstPage.totalItems && firstPage.items.length > 0) {
    const nextPage = await getUserFighters(accountId, { page, limit: 100 });
    items.push(...nextPage.items);
    if (nextPage.items.length < nextPage.pageSize) break;
    page += 1;
  }

  return {
    items,
    totalItems: firstPage.totalItems
  };
}

export function normalizeFighter(fighter, ownerAddress, accountId) {
  const id = String(fighter.id);
  const genes = fighter.genes || "";
  const genesMetamorph = fighter.genesMetamorph || "";

  return {
    id,
    name: fighter.name || "",
    title: fighter.title || "",
    class: fighter.class || "",
    ownerAddress,
    accountId,
    genes,
    genesMetamorph,
    renderGenes: genesMetamorph || null,
    ownership: fighter.ownership || null,
    collection: fighter.collection || null,
    parts: fighter.parts || [],
    standardImageUrl:
      `https://axiecdn.axieinfinity.com/axies/${id}/axie/axie-full-transparent.png`,
    collectibleTags: [],
    collectibleType: "Not collectible"
  };
}

// Simple heuristic classifier that tags fighters with collectible labels
// Uses title/name, parts, and genesMetamorph hints to assign known tags
export function getCollectibleType(tags) {
  const ordered = [
    "Origin",
    "MEO",
    "Agamogenesis",
    "Nightmare",
    "Mystic",
    "Shiny",
    "Summer",
    "Japan",
    "Xmas"
  ];

  const collectibleTags = (tags || []).filter((tag) => tag !== "Morphed");
  if (collectibleTags.length === 0) return "Not collectible";

  for (const tag of ordered) {
    if (collectibleTags.includes(tag)) return tag;
  }

  return collectibleTags.join(", ");
}

export function classifyCollectible(fighterRaw, normalized) {
  const tags = new Set();

  // Priority 1: Check title/name for Origin, MEO, Agamogenesis
  const title = String(fighterRaw.title || "").toLowerCase();

  if (title.includes("origin")) tags.add("Origin");
  if (title.includes("meo")) tags.add("MEO");
  if (title.includes("agamo") || title.includes("agamogenesis")) tags.add("Agamogenesis");

  // Collections and specialGenes are authoritative collectible metadata.
  const collectibleText = (value) => {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(collectibleText).join(" ");
    if (typeof value === "object") return Object.values(value).map(collectibleText).join(" ");
    return String(value).toLowerCase();
  };
  const collection = collectibleText(fighterRaw.collection);
  if (collection.includes("agamogenesis") || collection.includes("agamo")) tags.add("Agamogenesis");
  if (collection.includes("mystic")) tags.add("Mystic");
  if (collection.includes("christmas") || collection.includes("xmas")) tags.add("Xmas");
  if (collection.includes("summer")) tags.add("Summer");

  if (fighterRaw.genesMetamorph) tags.add("Morphed");

  // Priority 2: Fallback - parse part names for collectible indicators
  const parts = Array.isArray(fighterRaw.parts) ? fighterRaw.parts : [];
  for (const p of parts) {
    const combined = ((p.id || "") + " " + (p.name || "") + " " + (p.type || "") + " " + (p.class || "") + " " + collectibleText(p.specialGenes)).toLowerCase();
    const partSkin = Number(p.part_skin ?? p.partSkin ?? -1);
    if (partSkin === 12 || partSkin === 13) tags.add("Nightmare");
    if (partSkin === 13) tags.add("Shiny");
    if (combined.includes("japan")) tags.add("Japan");
    if (combined.includes("mystic")) tags.add("Mystic");
    if (combined.includes("shiny")) tags.add("Shiny");
    if (combined.includes("summer")) tags.add("Summer");
    if (combined.includes("xmas") || combined.includes("christmas")) tags.add("Xmas");
    if (combined.includes("nightmare")) tags.add("Nightmare");
  }

  // Priority 3: Apply lightweight geneDecoder for additional coverage
  try {
    const { tags: geneTags } = geneDecoder.detectCollectibleTags(fighterRaw);
    for (const t of geneTags) tags.add(t);
  } catch (err) {
    // non-fatal: keep existing tags
    console.error("geneDecoder error:", err.message || err);
  }

  normalized.collectibleTags = Array.from(tags);
  normalized.collectibleType = getCollectibleType(normalized.collectibleTags);
  return normalized;
}

export async function findFighterById(accountId, axieId) {
  const pageSize = 100;
  let page = 1;

  console.log(`[findFighterById] START: searching for axieId=${axieId} in accountId=${accountId}`);

  while (page <= 1000) {
    const pageResult = await getUserFighters(accountId, {
      page,
      limit: pageSize
    });

    const items = Array.isArray(pageResult.items) ? pageResult.items : [];
    console.log(`[findFighterById] Page ${page}: Got ${items.length} items from ${pageResult.totalItems} total`);

    const fighter = items.find((item) => String(item.id) === String(axieId));
    if (fighter) {
      console.log(`[findFighterById] FOUND on page ${page}: fighter.id=${fighter.id}`);
      return fighter;
    }

    // Stop only when the API stops returning a full page. totalPages is a hint,
    // not the source of truth: if the API reports a stale/incorrect total, a
    // full page result still means we have to keep paging. This covers accounts
    // with more than 100 fighters where a wrong totalPages value would otherwise
    // cause a false negative.
    if (items.length < pageSize) {
      console.log(`[findFighterById] BREAK: page ${page} returned fewer than ${pageSize} items; no more results expected`);
      break;
    }

    page += 1;
  }

  console.log(`[findFighterById] NOT FOUND after searching pages 1-${page - 1}. axieId=${axieId}, accountId=${accountId}`);
  return null;
}

export async function resolveAxieById(axieId) {
  let accountId;
  let ownerAddress;
  let delegateeAccountId = null;
  let delegateeAddress = null;

  if (USE_TEST_ACCOUNT) {
    accountId = TEST_ACCOUNT_ID;
    ownerAddress = TEST_OWNER_ADDRESS;
    console.log(`[resolveAxieById] Using TEST_ACCOUNT: accountId=${accountId}, ownerAddress=${ownerAddress}`);
  } else {
    console.log(`[resolveAxieById] Fetching axieDetail for ${axieId}`);
    const axieDetail = await getAxieOwnershipDetails(axieId);
    console.log(`[resolveAxieById] axieDetail fetched. ownerProfile:`, JSON.stringify(axieDetail?.ownerProfile || {}).slice(0, 200));

    // Check for delegation - if axie is delegated, prioritize delegatee's account
    if (axieDetail?.delegationState?.delegatee) {
      delegateeAddress = cleanRoninAddress(axieDetail.delegationState.delegatee);
      delegateeAccountId = axieDetail?.delegationState?.delegateeProfile?.accountId;
      console.log(`[resolveAxieById] ⚠️ DELEGATED AXIE: delegatee=${delegateeAddress}, delegateeAccountId=${delegateeAccountId}`);
    }

    // Get owner info
    accountId =
      axieDetail?.ownerProfile?.accountId || LIVE_ACCOUNT_ID;

    ownerAddress = axieDetail?.ownerProfile?.addresses?.ronin
      ? cleanRoninAddress(axieDetail.ownerProfile.addresses.ronin)
      : LIVE_OWNER_ADDRESS;

    console.log(`[resolveAxieById] Extracted: accountId=${accountId}, ownerAddress=${ownerAddress}`);
  }

  if (!ownerAddress && !delegateeAddress) {
    console.error(`[resolveAxieById] FAIL POINT 1: No owner or delegatee address. axieId=${axieId}`);
    throw new Error("No owner address was found.");
  }

  let ownerProfileAccountId = null;
  if (ownerAddress) {
    try {
      console.log(`[resolveAxieById] Resolving profile from ownerAddress: ${ownerAddress}`);
      const profile = await getProfileByRoninAddress(ownerAddress);
      ownerProfileAccountId = profile.accountId;
      console.log(`[resolveAxieById] Profile resolved. ownerProfileAccountId=${ownerProfileAccountId}`);
      if (!accountId) {
        accountId = ownerProfileAccountId;
        console.log(`[resolveAxieById] Set accountId from profile: ${accountId}`);
      }
    } catch (error) {
      console.warn(`[resolveAxieById] FAIL POINT 2: Failed to resolve profile for Ronin address ${ownerAddress}:`, error.message);
    }
  }

  if (!accountId && !delegateeAccountId) {
    console.error(`[resolveAxieById] FAIL POINT 3: No account ID could be resolved. LIVE_ACCOUNT_ID=${LIVE_ACCOUNT_ID}`);
    throw new Error("No account ID was found.");
  }

  console.log(`[resolveAxieById] RESOLVED: OWNER accountId=${accountId}, DELEGATEE accountId=${delegateeAccountId || "N/A"}`);

  let fighter = null;
  const triedAccountIds = new Set();

  async function tryAccount(account, label = "") {
    if (!account || triedAccountIds.has(account)) {
      console.log(`[resolveAxieById] Skipping account lookup: account=${account}, already tried=${triedAccountIds.has(account)}`);
      return null;
    }
    triedAccountIds.add(account);
    try {
      console.log(`[resolveAxieById] ${label} Searching fighters for axieId=${axieId} in accountId=${account}`);
      return await findFighterById(account, axieId);
    } catch (error) {
      console.warn(`[resolveAxieById] Fighter lookup failed for account ${account}:`, error.message);
      return null;
    }
  }

  // Priority 1: If delegated, try delegatee's account FIRST (where the fighter actually is)
  if (delegateeAccountId) {
    fighter = await tryAccount(delegateeAccountId, "🎯 DELEGATEE:");
    if (fighter) {
      console.log(`[resolveAxieById] ✓ Found fighter in DELEGATEE account ${delegateeAccountId}`);
      accountId = delegateeAccountId;
      ownerAddress = delegateeAddress;
    } else {
      console.log(`[resolveAxieById] ✗ Fighter not found in delegatee account, falling back to owner...`);
    }
  }

  // Priority 2: Try owner's primary account
  if (!fighter) {
    fighter = await tryAccount(accountId, "👤 OWNER:");
    if (fighter) {
      console.log(`[resolveAxieById] ✓ Found fighter in OWNER primary account ${accountId}`);
    }
  }

  // Priority 3: Try owner's profile-resolved account
  if (!fighter && ownerProfileAccountId) {
    console.log(`[resolveAxieById] Fighter not found in primary; trying ownerProfileAccountId=${ownerProfileAccountId}`);
    fighter = await tryAccount(ownerProfileAccountId, "👤 OWNER (PROFILE):");
    if (fighter) {
      accountId = ownerProfileAccountId;
      console.log(`[resolveAxieById] ✓ Found fighter in owner profile account, updated accountId=${accountId}`);
    }
  }

  // Do not silently retry the active tracker profile after the normal owner /
  // delegatee / profile-resolution attempts have already failed. If the selected
  // profile cannot resolve this axie, fail loudly instead of hiding a bad config
  // behind a second lookup pass.

  // Final fallback: Use GraphQL detail (without parts if delegated)
  if (!fighter) {
    console.warn(
      `[resolveAxieById] ⚠️ Axie ${axieId} not found in fighter lists for accounts: ${Array.from(triedAccountIds).join(", ")}. Falling back to GraphQL detail.`
    );
    fighter = await getAxieMarketplaceDetails(axieId);
    console.log(`[resolveAxieById] GraphQL fallback returned fighter. hasPartsData=${Array.isArray(fighter.parts) && fighter.parts.length > 0}`);

  }

  let normalized = normalizeFighter(fighter, ownerAddress, accountId);
  normalized = classifyCollectible(fighter, normalized);

  return normalized;
}
