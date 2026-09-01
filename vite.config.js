import { defineConfig, loadEnv } from "vite";
import { resolveActiveProfile } from "./src/server/shared/trackerProfiles.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // trackerProfiles.js reads process.env directly (see that file for why),
  // so merge whatever Vite's own loader found in .env / .env.[mode] into
  // process.env before resolving the profile. This keeps env.js (Node
  // server, via dotenv) and vite.config.js (frontend, via Vite's loadEnv)
  // reading the same underlying .env file through one shared resolver,
  // rather than duplicating the profile logic here.
  Object.assign(process.env, env);
  const activeProfile = resolveActiveProfile();

  const frontendPort = activeProfile.vitePort;
  const backendPort = activeProfile.port;

  return {
    server: {
      host: "127.0.0.1",
      port: frontendPort,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true
        }
      }
    },
    define: {
      // Explicitly injected from the resolved profile rather than left to
      // Vite's automatic VITE_*-prefix exposure, since a non-default
      // profile's values live under indexed names (TRACKER_PROFILE_2_VITE_*)
      // that Vite wouldn't recognize as VITE_LEADERBOARD_LIMIT etc. on its
      // own. This way import.meta.env.VITE_LEADERBOARD_LIMIT always reflects
      // whichever profile is active, for every profile including the default.
      "import.meta.env.VITE_LEADERBOARD_LIMIT": JSON.stringify(
        String(activeProfile.viteLeaderboardLimit)
      ),
      "import.meta.env.VITE_LEADERBOARD_OFFSET": JSON.stringify(
        String(activeProfile.viteLeaderboardOffset)
      ),
      "import.meta.env.VITE_POLLING_INTERVAL": JSON.stringify(
        String(activeProfile.vitePollingInterval)
      )
    }
  };
});
