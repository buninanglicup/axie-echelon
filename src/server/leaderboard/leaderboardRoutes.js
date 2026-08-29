import express from "express";
import leaderboardLegacyRoutes from "./leaderboardLegacyRoutes.js";
import leaderboardEnrichmentRoutes from "./leaderboardEnrichmentRoutes.js";
import leaderboardPoolRoutes from "./leaderboardPoolRoutes.js";
import leaderboardRuneRoutes from "./leaderboardRuneRoutes.js";

const router = express.Router();

router.use(leaderboardRuneRoutes);
router.use(leaderboardPoolRoutes);
router.use(leaderboardEnrichmentRoutes);
router.use(leaderboardLegacyRoutes);

export default router;
