import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const frontendPort = Number(env.VITE_PORT || 5173);
  const backendPort = Number(env.PORT || 8787);

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
    }
  };
});