// Passwords, login sessions and cookies.
import { createHash, createHmac, pbkdf2, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.ts";
import type { Repo } from "./db.ts";

// ---------- Password hashes ----------

function scryptAsync(password: string, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 256 * N * r * p }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

function pbkdf2Async(password: string, salt: Buffer, iterations: number, keylen: number, digest: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    pbkdf2(password, salt, iterations, keylen, digest, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && a.length > 0 && timingSafeEqual(a, b);

/** "scrypt$N$r$p$salt$hash" (base64), the format Wealth Tracker uses, so both apps can share one password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const N = 2 ** 15, r = 8, p = 1;
  const key = await scryptAsync(password, salt, 64, N, r, p);
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

/**
 * Checks a password against a stored hash: Wealth Tracker's "scrypt$N$r$p$salt$hash", or werkzeug's
 * "scrypt:N:r:p$salt$hex" / "pbkdf2:sha256:iterations$salt$hex" (accounts made by the Flask version).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (stored.startsWith("scrypt$")) {
      const [, N, r, p, salt, hash] = stored.split("$");
      const expected = Buffer.from(hash, "base64");
      return sameBytes(await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, +N, +r, +p), expected);
    }
    const [method, salt, hash] = stored.split("$");
    if (salt === undefined || hash === undefined) return false;
    const expected = Buffer.from(hash, "hex");
    const [algo, ...args] = method.split(":");
    if (algo === "scrypt") {
      const [N = 2 ** 15, r = 8, p = 1] = args.map(Number);
      return sameBytes(await scryptAsync(password, Buffer.from(salt, "utf8"), expected.length, N, r, p), expected);
    }
    if (algo === "pbkdf2") {
      const digest = args[0] || "sha256";
      const iterations = Number(args[1] || 600000);
      return sameBytes(await pbkdf2Async(password, Buffer.from(salt, "utf8"), iterations, expected.length, digest), expected);
    }
  } catch {
    // A malformed hash never matches.
  }
  return false;
}

// ---------- Users ----------

export const normalizeUserId = (value: unknown) => String(value ?? "").trim().toLowerCase();
export const validUserId = (value: string) => /^[a-z0-9_-]{3,32}$/.test(value);

/** Accounts with their own hash in the profile, or the single configured user (APP_PASSWORD_HASH / APP_PASSWORD). */
export async function passwordMatches(config: Config, username: string, profile: Record<string, any>, password: string) {
  const own = String(profile.password_hash || "");
  if (own) return verifyPassword(password, own);
  if (username !== config.singleUserId) return false;
  if (config.appPasswordHash) return verifyPassword(password, config.appPasswordHash);
  return !config.appPassword || password === config.appPassword;
}

/** Signed-in users must fill in their profile first (once a password protects the app). */
export const profileRequired = (config: Config, profile: Record<string, any>) =>
  Boolean(profile.password_hash || config.appPassword || config.appPasswordHash);

export const profileComplete = (profile: Record<string, any>) =>
  ["age", "gender", "height_cm", "weight_kg", "activity_level", "goal"].every((key) => Boolean(profile[key]));

// ---------- Sessions ----------

export const SESSION_COOKIE = "mydiet_session";
export const LANG_COOKIE = "mydiet_lang";
export const DEMO_COOKIE = "mydiet_demo";
export const VISITED_COOKIE = "mydiet_visited";
const FLASK_COOKIE = "session";
const YEAR_SECONDS = 365 * 86400;
const DAY_MS = 86400_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return value.join("=");
      }
    }
  }
}

export function setCookie(req: FastifyRequest, reply: FastifyReply, name: string, value: string, maxAgeSec: number) {
  // Secure when served over HTTPS (behind Caddy, which says so).
  const secure = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
  const existing = reply.getHeader("set-cookie");
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  reply.header("set-cookie", [...list.filter((c) => !c.startsWith(`${name}=`)), cookie]);
}

export const clearCookie = (req: FastifyRequest, reply: FastifyReply, name: string) => setCookie(req, reply, name, "", 0);

/** Sessions last a year and every visit pushes the expiry forward, so the home-screen app stays signed in. */
export function createSession(repo: Repo, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + YEAR_SECONDS * 1000).toISOString();
  repo.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expires);
  setCookie(req, reply, SESSION_COOKIE, token, YEAR_SECONDS);
}

export function deleteSession(repo: Repo, req: FastifyRequest, reply: FastifyReply) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) repo.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  clearCookie(req, reply, SESSION_COOKIE);
}

/** The user signed in with this request's session cookie, sliding the expiry forward (at most once a day). */
export function sessionUser(repo: Repo, req: FastifyRequest, reply: FastifyReply): string | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const hash = sha256(token);
  const row = repo.db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(hash) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!row || row.expires_at <= new Date().toISOString()) return null;
  if (Date.parse(row.expires_at) - Date.now() < YEAR_SECONDS * 1000 - DAY_MS) {
    const expires = new Date(Date.now() + YEAR_SECONDS * 1000).toISOString();
    repo.db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(expires, hash);
    setCookie(req, reply, SESSION_COOKIE, token, YEAR_SECONDS);
  }
  return row.user_id;
}

export function deleteExpiredSessions(repo: Repo) {
  repo.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

// ---------- The Flask version's cookie ----------

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * Reads a login cookie signed by the old Flask app (itsdangerous: HMAC-SHA1, salt "cookie-session"), so devices
 * that were signed in stay signed in after the move. Returns the session's contents, or null if it isn't valid.
 */
export function readFlaskSession(cookie: string | undefined, secretKey: string, maxAgeSec = YEAR_SECONDS): Record<string, any> | null {
  if (!cookie || !secretKey) return null;
  const at = cookie.lastIndexOf(".");
  if (at < 0) return null;
  const value = cookie.slice(0, at);
  const signature = b64url(cookie.slice(at + 1));
  const derived = createHmac("sha1", secretKey).update("cookie-session").digest();
  const expected = createHmac("sha1", derived).update(value).digest();
  if (!sameBytes(signature, expected)) return null;
  const tsAt = value.lastIndexOf(".");
  const timestamp = b64url(value.slice(tsAt + 1)).readUIntBE(0, Math.min(6, b64url(value.slice(tsAt + 1)).length));
  if (Date.now() / 1000 - timestamp > maxAgeSec) return null;
  let payload = value.slice(0, tsAt);
  const compressed = payload.startsWith(".");
  if (compressed) payload = payload.slice(1);
  try {
    const raw = b64url(payload);
    const data = JSON.parse((compressed ? inflateSync(raw) : raw).toString("utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export const FLASK_SESSION_COOKIE = FLASK_COOKIE;
