import express from "express";
import { runeRegistry } from "./runeCatalog.js";

const router = express.Router();

// The synchronous /api/leaderboard/rune/:runeId scan was retired in favor of
// the async job endpoints in leaderboardRuneScanRoutes.js.

router.get("/api/runes", (request, response) => {
  response.json({ runes: Object.values(runeRegistry) });
});

export default router;