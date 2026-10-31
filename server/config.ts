// Settings from the environment (systemd reads /etc/mydiet.env) plus config/app_settings.json.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type Config = {
  appEnv: string;
  /** Plain password for the single user (local testing). */
  appPassword: string;
  /** Hash of the single user's password: werkzeug ("scrypt:…$salt$hex", "pbkdf2:…") or Wealth Tracker ("scrypt$N$r$p$salt$hash"). */
  appPasswordHash: string;
  /** The Flask app's secret: only used to accept its old login cookies once, so nobody is signed out by the move. */
  flaskSecretKey: string;
  anthropicApiKey: string;
  singleUserId: string;
  mcpToken: string;
  dbPath: string;
  demoDbPath: string;
  uploadDir: string;
  claudeModel: string;
  analysisPromptPath: string;
  timezone: string;
};

function appSettings(appEnv: string): Record<string, unknown> {
  const path = resolve("config/app_settings.json");
  if (!existsSync(path)) return {};
  const payload = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  const base: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) if (key !== "default" && key !== "environments") base[key] = value;
  if (payload.default && typeof payload.default === "object") Object.assign(base, payload.default);
  const env = payload.environments?.[appEnv];
  if (env && typeof env === "object") Object.assign(base, env);
  return base;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const appEnv = env.APP_ENV ?? "staging";
  const app = appSettings(appEnv);
  return {
    appEnv,
    appPassword: env.APP_PASSWORD ?? "",
    appPasswordHash: env.APP_PASSWORD_HASH ?? "",
    flaskSecretKey: env.FLASK_SECRET_KEY ?? "",
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
    singleUserId: env.SINGLE_USER_ID || "halil",
    mcpToken: env.MCP_TOKEN ?? "",
    dbPath: env.MYDIET_DB ?? "data/mydiet.db",
    demoDbPath: env.MYDIET_DEMO_DB ?? "data/demo.db",
    uploadDir: String(app.upload_dir || "uploads"),
    claudeModel: String(app.claude_model || "claude-opus-5-5"),
    analysisPromptPath: String(app.analysis_prompt_path || "config/analysis_prompt.en.txt"),
    timezone: String(app.timezone || "Europe/Amsterdam"),
    ...overrides,
  };
}

export const isProduction = (config: Config) => ["prod", "production"].includes(config.appEnv.toLowerCase());
