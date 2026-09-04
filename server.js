// PHASE 1 FILE SPLIT (2026-08-19).
// This file used to be ~1830 lines containing route handlers, caching,
// GraphQL calls, battle-log fetching, rune scanning, and the axie-lookup
// feature all mixed together. It's now a thin entry point: app setup,
// static serving, mounting the two feature routers, and process lifecycle.
// All business logic lives under src/server/ -- see:
//   src/server/shared/       -- env config, GraphQL client, validators,
//                                concurrency primitives, profile cache
//                                (used by both features below)
//   src/server/axieService.js, src/server/axieRoutes.js
//                             -- the Ronin-address / Axie-ID lookup feature
//   src/server/leaderboard/  -- the leaderboard feature (enrichment,
//                                caching, rune scanning, routes)
//
// IMPORTANT: env.js must be the first internal import anywhere in the
// import graph, since it runs dotenv.config() as a side effect and every
// other module reads process.env-derived constants that depend on that
// having already run. Node evaluates ES module imports depth-first before
// any of this file's own top-level code runs, so as long as env.js is
// imported (even transitively, as it is here via axieRoutes.js and
// leaderboardRoutes.js) before anything calls out to Skymavis, ordering is
// safe -- this direct import makes that dependency explicit rather than
// relying on it happening to work transitively.
import "./src/server/shared/env.js";

import express from "express";
import cors from "cors";
import path from "node:path";
import { allowedOrigin, port } from "./src/server/shared/env.js";
import axieRoutes from "./src/server/axieRoutes.js";
import seasonRoutes from "./src/server/seasonRoutes.js";
import leaderboardRoutes from "./src/server/leaderboard/leaderboardRoutes.js";
import leaderboardRuneScanRoutes from "./src/server/leaderboard/leaderboardRuneScanRoutes.js";

console.log(`Starting server on port ${port} (${process.env.PORT ? 'PORT env override' : 'default port 8787'})`);

const app = express();

app.use(
  cors({
    origin: allowedOrigin
  })
);

app.get("/", (request, response) => {
  response.sendFile(path.resolve("index.html"));
});

app.use(express.static(path.resolve(".")));

app.use(axieRoutes);
app.use(seasonRoutes);
app.use(leaderboardRoutes);
app.use(leaderboardRuneScanRoutes);

// ========== SERVER INITIALIZATION ==========
// Runes are loaded from the pre-generated static registry in src/data/runes.json.
// We intentionally do not fetch the catalog at startup.

function start() {
  const server = app.listen(port, () => {
    console.log(`API server running at http://127.0.0.1:${port}`);
  });

  function handleShutdown(signal) {
    console.log(`Received ${signal}. Shutting down server...`);
    server.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
    setTimeout(() => {
      console.warn("Forced shutdown after 5 seconds.");
      process.exit(1);
    }, 5000).unref();
  }

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    process.exit(1);
  });

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the process using it or set PORT to a free port.`
      );
      process.exit(1);
    }
    console.error("Server error:", error);
    process.exit(1);
  });
}

// Start the server
start();
