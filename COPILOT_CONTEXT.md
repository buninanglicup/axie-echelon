# Axie Morph Viewer - Copilot Continuation Prompt

## Project Overview
Axie Infinity web app that searches axies by ID or Ronin address and renders morph previews using PIXI/Spine. Backend: Node.js/Express. Frontend: Vite + vanilla JS. Runs on http://127.0.0.1:8787 (backend) and http://127.0.0.1:5173 (frontend).

## Current Architecture

### Axie Delegation (Critical Discovery)
- Axies can be delegated: owner holds NFT, delegatee uses it in battles
- GraphQL returns owner info via `ownerProfile` (owner's accountId)
- Fighter records exist ONLY in delegatee's account in Mavis Fighters API
- **Ownership and usage are separated at API level**

### Backend (server.js)
- **Main Routes:**
  - `GET /api/axie/:id` → resolveAxieById (delegation-aware with detailed logging)
  - `GET /api/address/:address` → Profile resolution + fighters fetch with logging
- **GraphQL Endpoints:** https://api-gateway.skymavis.com/graphql/axie-marketplace (requires x-api-key)
- **REST API:** https://api-gateway.skymavis.com/origins/v2/community/users/fighters (Mavis fighters, requires X-API-Key)
- **Key Functions:**
  - `getAxieOwnershipDetails(axieId)` - Gets Axie ownership + delegation state
  - `getAxieMarketplaceDetails(axieId)` - Gets full Axie marketplace data with parts
  - `resolveAxieById(axieId)` - NEW: Delegation-aware priority order (delegatee → owner → fallback)
  - `getUserFighters(accountId)` - Fetches fighter list from Mavis API
  - `classifyCollectible(fighterRaw, normalized)` - 3-tier priority: title/name → parts parsing → geneDecoder
  - `normalizeFighter()` - Standardizes fighter data structure

### Frontend (src/main.js)
- **Search Modes:** "id" (Axie ID) or "address" (Ronin address)
- **Filters:** 8 collectible tags (Nightmare, Shiny, Summer, Japan, Xmas, MEO, Origin, Agamogenesis) + "Show only collectibles" toggle
- **Key Functions:**
  - `updateFilterAvailability()` - Disables filters in "id" mode (prevents false hiding)
  - `applyFilters(items)` - Filters by activeTags and showOnlyCollectibles toggle
  - `renderPageFromServer(page, body)` - Paginated server-side results
  - `renderPage(page)` - Local pagination for ID lookups
  - `addAxieCard(axie, target)` - Renders card with static morph snapshot, marketplace/battle log links

### Renderer (src/renderer.js)
- Uses PIXI/Spine for morph previews
- **Static snapshot extraction** implemented (stops blinking animation)
- Snapshots placed in DOM for list display (no animated ticker)

## Recent Fixes Applied
- ✅ Removed non-existent `num*` GraphQL fields (numShiny, numJapan, etc.)
- ✅ Rewrote `resolveAxieById()` with delegation-aware priority ordering
- ✅ Added `delegationState` to GraphQL queries
- ✅ Disabled filters in "id" mode via `updateFilterAvailability()`
- ✅ Implemented static snapshot rendering (eliminated image blinking)
- ✅ Added marketplace/battle log links with open-in-new-tab
- ✅ Enhanced error logging in `/api/address` fighter processing loop

## Known Issues / Outstanding Tasks
1. **Address search returns 0 fighters from Mavis API** (even though totalItems shows 119 in browser)
   - Possible causes: API rate limiting, account ID mismatch, or pagination params
   - Needs investigation: Check server logs for Mavis API response
   - Action: Add more detailed logging to `getUserFighters()` error handling

2. **Delegated Axie ID lookup (ID 12014982)** - Backend logic added, not yet tested in production
   - Action: Test with production axie ID that is delegated; verify server logs show `🎯 delegatee` path

3. **"Show only collectibles" defaults to true**
   - Results in all non-collectible axies hidden by default
   - Consider changing default to `false` for better UX

## Code Locations
- `src/server/shared/marketplaceAxieClient.js` - marketplace Axie ownership and detail queries
- `server.js:450-530` - `resolveAxieById()` (delegation priority logic)
- `server.js:271-320` - `getUserFighters()` (Mavis API call)
- `server.js:375-420` - `classifyCollectible()` (3-tier priority)
- `src/main.js:586-620` - `applyFilters()` (filter logic)
- `src/main.js:243-300` - `renderPage()` (ID mode pagination)
- `src/main.js:346-470` - `renderPageFromServer()` (address mode pagination)
- `src/main.js:470-550` - `addAxieCard()` (card rendering with static snapshot)

## Environment
- OS: Windows
- Node.js server runs on port 8787
- Vite dev server on port 5173
- Uses `.env` for AXIE_ECHELON_API_KEY, SKYMAVIS_API_KEY, LIVE_ACCOUNT_ID
- DEBUG_ON flag enables conditional logging throughout

## Next Steps
1. Investigate why Mavis API returns 0 items for address searches (priority blocker)
2. Test delegated axie lookup with production axie ID
3. Consider defaulting "Show only collectibles" to false
4. Monitor collectible tag classification accuracy with real data

## Quick Commands
```powershell
# Start server
node server.js

# Start frontend (separate terminal)
npm run dev
```

Test address: `0x93144b2cf85af14f50ba9875c3608fce81fb1805` (shows 119 items but displays 0 on frontend)
Test delegated axie: ID 12014982
