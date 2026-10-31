import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.API_PORT ?? "8080";
const api = `http://localhost:${apiPort}`;

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": api, "/mcp": api, "/demo": api, "/uploads": api } },
});
