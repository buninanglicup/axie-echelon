import express from "express";
import { getCurrentEraForConfiguredSeason } from "../eraResolver.js";

const router = express.Router();

// Sky Mavis calls an era's numeric selector `milestone`; internal callers use
// `eraMilestone` so the API naming stays at the boundary.
export function resolveEraMilestone(request) {
  return request.query.milestone
    ? String(request.query.milestone)
    : String(getCurrentEraForConfiguredSeason().milestone);
}

router.get("/api/season/current", (request, response) => {
  response.json(getCurrentEraForConfiguredSeason());
});

export default router;