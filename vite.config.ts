import { defineConfig } from "vite";
import { buildInfo } from "./build-info.ts";
import react from "@vitejs/plugin-react";

const apiPort = process.env.API_PORT ?? "8080";
const api = `http://localhost:${apiPort}`;

// Footer version: v<MAJOR>.<commits on main>, so every merge raises it. Raise MAJOR by hand for a big release.
const MAJOR = "1";

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify(buildInfo({ major: MAJOR, repo: "halilayyildiz/mydiet" })) },
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": api, "/mcp": api, "/demo": api, "/uploads": api } },
});
