// Per-user connector tokens, password resets and a small in-memory rate limiter.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.ts";
import type { Repo } from "./db.ts";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
const newSecret = (bytes: number) => randomBytes(bytes).toString("base64url");

export const MIN_PASSWORD = 8;
export const RESERVED_USERNAMES = new Set(["demo", "admin", "root", "mydiet"]);

/** The admin is the original single user (SINGLE_USER_ID): they make password reset links. */
export const isAdmin = (config: Config, userId: string | null) => !!userId && userId === config.singleUserId;

// ---------- Connector tokens ----------

/** The user's connector secret, made on first use. The admin keeps using MCP_TOKEN until they make a new one. */
export function userToken(repo: Repo, config: Config, userId: string): string {
  const row = repo.db.prepare("SELECT token FROM user_tokens WHERE user_id = ?").get(userId) as { token: string } | undefined;
  if (row) return row.token;
  if (isAdmin(config, userId) && config.mcpToken) return config.mcpToken;
  return rotateUserToken(repo, userId);
}

/** A fresh secret; the old URL stops working (except the admin's MCP_TOKEN, which the server config owns). */
export function rotateUserToken(repo: Repo, userId: string): string {
  const token = newSecret(24);
  repo.db
    .prepare("INSERT INTO user_tokens (user_id, token, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at")
    .run(userId, token, now());
  return token;
}

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** Whose data a connector URL secret writes to, or null. */
export function tokenUser(repo: Repo, config: Config, token: string): string | null {
  if (!token) return null;
  if (config.mcpToken && sameText(token, config.mcpToken)) return config.singleUserId;
  const row = repo.db.prepare("SELECT user_id FROM user_tokens WHERE token = ?").get(token) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

// ---------- Password resets ----------

const RESET_DAYS = 3;

export function createReset(repo: Repo, userId: string): string {
  const token = newSecret(24);
  const expires = new Date(Date.now() + RESET_DAYS * 86400_000).toISOString();
  repo.db.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at <= ?").run(userId, now());
  repo.db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expires);
  return token;
}

/** The user a reset link is for (and uses it up), or null when it is unknown or expired. */
export function takeReset(repo: Repo, token: string): string | null {
  if (!token) return null;
  const hash = sha256(token);
  const row = repo.db.prepare("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?").get(hash) as
    | { user_id: string; expires_at: string }
    | undefined;
  repo.db.prepare("DELETE FROM password_resets WHERE token_hash = ?").run(hash);
  return row && row.expires_at > now() ? row.user_id : null;
}

export function deleteUserSessions(repo: Repo, userId: string) {
  repo.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// ---------- Rate limits ----------

/** At most `limit` hits per key in `windowMs`; kept in memory (one small process). */
export class RateLimit {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** True while the key is still under its limit. */
  allowed(key: string): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => Date.now() - t < this.windowMs);
    if (recent.length) this.hits.set(key, recent);
    else this.hits.delete(key);
    return recent.length < this.limit;
  }

  hit(key: string) {
    const recent = this.hits.get(key) ?? [];
    recent.push(Date.now());
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.hits.delete(this.hits.keys().next().value!);
  }

  clear(key: string) {
    this.hits.delete(key);
  }
}
