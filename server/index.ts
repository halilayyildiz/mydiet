// Start the server: `node server/index.ts` (systemd runs it behind Caddy on 127.0.0.1:8080).
import { buildApp } from "./app.ts";
import { isProduction, loadConfig } from "./config.ts";

const config = loadConfig();
const app = await buildApp({ config, logger: true });
// API_PORT, not PORT: dev tools often set PORT for the Vite server.
const port = Number(process.env.API_PORT ?? 8080);
const host = process.env.HOST ?? "127.0.0.1";
if (isProduction(config) && !config.appPassword && !config.appPasswordHash) {
  console.warn("Note: neither APP_PASSWORD_HASH nor APP_PASSWORD is set; only accounts with their own password can sign in.");
}
await app.listen({ port, host });
console.log(`MyDiet: http://${host}:${port}`);
