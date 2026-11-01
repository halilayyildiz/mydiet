// The web app: JSON API for the React UI, login, the demo, the Claude connector and the Shortcut weight endpoint.
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "./config.ts";
import { Repo } from "./db.ts";
import { addDays, dateRangeLabel, dateWindow, isMonth, isoDate, localDate, shiftMonth } from "./dates.ts";
import { RANGE_OPTIONS, computeBmrCalories, foodItemGroups, toFloat } from "./nutrition.ts";
import { analyzeEntry, claudeAnalyzer, type Analyzer } from "./claude.ts";
import { DEMO_USER, ensureDemoData } from "./demo.ts";
import { registerMcp } from "./mcp.ts";
import {
  MIN_PASSWORD, RESERVED_USERNAMES, RateLimit, createReset, deleteUserSessions, isAdmin, rotateUserToken, takeReset, userToken,
} from "./accounts.ts";
import { averages, balanceSummary, calendar, profileWithBmr, totals, trendSeries, weightSeries } from "./dashboard.ts";
import {
  DEMO_COOKIE, FLASK_SESSION_COOKIE, LANG_COOKIE, VISITED_COOKIE, clearCookie, createSession, deleteExpiredSessions,
  deleteSession, hashPassword, normalizeUserId, passwordMatches, profileComplete, profileRequired, readCookie,
  readFlaskSession, sessionUser, setCookie, validUserId,
} from "./auth.ts";

const LANGS = ["en", "tr"];
const YEAR = 365 * 86400;
const TEN_YEARS = 10 * YEAR;

/** Who is asking: a signed-in user, a demo visitor, or nobody. */
type Visitor = { userId: string | null; demo: boolean; lang: string; repo: Repo };

export type AppOptions = { config: Config; analyzer?: Analyzer | null; logger?: boolean; distDir?: string };

class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function buildApp({ config, analyzer, logger = false, distDir = "dist" }: AppOptions) {
  const app = Fastify({ logger: logger ? { level: "warn" } : false, trustProxy: true, bodyLimit: 12 * 1024 * 1024 });
  const real = new Repo(config.dbPath);
  const demoRepo = new Repo(config.demoDbPath);
  const analyze = analyzer !== undefined ? analyzer : config.anthropicApiKey ? claudeAnalyzer(config) : null;
  deleteExpiredSessions(real);
  const today = () => localDate(config.timezone);

  // Bodies: JSON (bad JSON is just "no body", like Flask's get_json(silent=True)), forms, and anything else as text.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "*"], { parseAs: "string" }, (req, body, done) =>
    done(null, parseBody(String(req.headers["content-type"] ?? ""), body as string)),
  );

  app.setErrorHandler((err: any, req, reply) => {
    if (!(err instanceof HttpError)) req.log.error(err);
    const status = err instanceof HttpError ? err.statusCode : err.statusCode ?? 500;
    reply.status(status).send({ error: err instanceof HttpError ? err.code : status >= 500 ? "server_error" : err.message });
  });

  // The Claude connector and the Shortcut always write the real data, never the demo.
  registerMcp(app, real, config);

  // ---------- Who is this? ----------

  function visitor(req: FastifyRequest, reply: FastifyReply): Visitor {
    const cookieLang = readCookie(req, LANG_COOKIE);
    if (readCookie(req, DEMO_COOKIE) === "1") {
      ensureDemoData(demoRepo, today());
      return { userId: DEMO_USER, demo: true, lang: LANGS.includes(cookieLang!) ? cookieLang! : "en", repo: demoRepo };
    }
    let userId = sessionUser(real, req, reply);
    let lang = LANGS.includes(cookieLang!) ? cookieLang! : null;
    if (!userId) {
      // Signed in with the Flask version: carry the login over to a new session, once.
      const old = readFlaskSession(readCookie(req, FLASK_SESSION_COOKIE), config.flaskSecretKey);
      if (old) {
        clearCookie(req, reply, FLASK_SESSION_COOKIE);
        if (old.authenticated && !old.demo && typeof old.user_id === "string") {
          userId = old.user_id;
          createSession(real, req, reply, userId);
        }
        if (!lang && LANGS.includes(old.lang)) {
          lang = old.lang;
          setCookie(req, reply, LANG_COOKIE, old.lang, YEAR);
        }
      }
    }
    if (!lang && userId) {
      const preferred = real.getProfile(userId).preferred_language;
      if (LANGS.includes(preferred)) lang = preferred;
    }
    return { userId, demo: false, lang: lang ?? "en", repo: real };
  }

  /** The signed-in user (or demo visitor); 401 otherwise. */
  function signedIn(req: FastifyRequest, reply: FastifyReply) {
    const v = visitor(req, reply);
    if (!v.userId) throw new HttpError(401, "unauthorized");
    return v as Visitor & { userId: string };
  }

  /** Changes need a real account: the demo is read-only. */
  function writer(req: FastifyRequest, reply: FastifyReply) {
    const v = signedIn(req, reply);
    if (v.demo) throw new HttpError(403, "demo_read_only");
    return v;
  }

  const needsProfile = (v: Visitor) => {
    if (!v.userId || v.demo) return false;
    const profile = v.repo.getProfile(v.userId);
    return profileRequired(config, profile) && !profileComplete(profile);
  };

  // ---------- Session, login, language ----------

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/session", async (req, reply) => {
    const v = visitor(req, reply);
    return {
      authenticated: !!v.userId, username: v.userId, demo: v.demo, admin: !v.demo && isAdmin(config, v.userId),
      lang: v.lang, needsProfile: needsProfile(v), today: today(),
    };
  });

  // Five wrong passwords from one address lock sign-in for 15 minutes.
  const failures = new Map<string, number[]>();
  const WINDOW_MS = 15 * 60_000;

  app.post("/api/login", async (req, reply) => {
    const recent = (failures.get(req.ip) ?? []).filter((t) => Date.now() - t < WINDOW_MS);
    failures.set(req.ip, recent);
    if (recent.length >= 5) throw new HttpError(429, "too_many_attempts");
    const body = req.body as Record<string, any>;
    const username = normalizeUserId(body?.username);
    const profile = username ? real.getProfile(username) : {};
    if (!username || !(await passwordMatches(config, username, profile, String(body?.password ?? "")))) {
      recent.push(Date.now());
      throw new HttpError(401, "incorrect_password");
    }
    failures.delete(req.ip);
    deleteSession(real, req, reply);
    clearCookie(req, reply, DEMO_COOKIE);
    createSession(real, req, reply, username);
    if (LANGS.includes(profile.preferred_language)) setCookie(req, reply, LANG_COOKIE, profile.preferred_language, YEAR);
    return { ok: true, needsProfile: profileRequired(config, profile) && !profileComplete(profile) };
  });

  // Anyone may sign up; one address may make 3 accounts a day (and 100 a day in all), and try 20 times an hour.
  const signupTries = new RateLimit(20, 60 * 60_000);
  const signupsByIp = new RateLimit(3, 24 * 60 * 60_000);
  const signupsTotal = new RateLimit(100, 24 * 60 * 60_000);

  const checkPassword = (password: string) => {
    if (password.length < MIN_PASSWORD) throw new HttpError(400, "password_too_short");
  };

  app.post("/api/register", async (req, reply) => {
    const v = visitor(req, reply);
    if (v.userId && !v.demo) throw new HttpError(409, "already_signed_in");
    if (!signupTries.allowed(req.ip)) throw new HttpError(429, "too_many_attempts");
    signupTries.hit(req.ip);
    const body = req.body as Record<string, any>;
    const username = normalizeUserId(body?.username);
    const password = String(body?.password ?? "");
    if (!validUserId(username) || RESERVED_USERNAMES.has(username)) throw new HttpError(400, "invalid_username");
    checkPassword(password);
    if (Object.keys(real.getProfile(username)).length) throw new HttpError(409, "user_already_exists");
    if (!signupsByIp.allowed(req.ip) || !signupsTotal.allowed("all")) throw new HttpError(429, "too_many_signups");
    const passwordHash = await hashPassword(password);
    // Checked again after the slow hash, in case the same name was taken meanwhile.
    if (Object.keys(real.getProfile(username)).length) throw new HttpError(409, "user_already_exists");
    real.saveProfile(username, { username, password_hash: passwordHash, preferred_language: v.lang, created_at: new Date().toISOString() });
    signupsByIp.hit(req.ip);
    signupsTotal.hit("all");
    clearCookie(req, reply, DEMO_COOKIE);
    createSession(real, req, reply, username);
    return { ok: true, needsProfile: true };
  });

  app.post("/api/password", async (req, reply) => {
    const v = writer(req, reply);
    if (!signupTries.allowed(`pw:${v.userId}`)) throw new HttpError(429, "too_many_attempts");
    const body = req.body as Record<string, any>;
    const profile = real.getProfile(v.userId);
    if (!(await passwordMatches(config, v.userId, profile, String(body?.current_password ?? "")))) {
      signupTries.hit(`pw:${v.userId}`);
      throw new HttpError(401, "incorrect_current_password");
    }
    const password = String(body?.new_password ?? "");
    checkPassword(password);
    real.saveProfile(v.userId, { password_hash: await hashPassword(password) });
    // Other devices sign in again with the new password; this one stays signed in.
    deleteUserSessions(real, v.userId);
    createSession(real, req, reply, v.userId);
    return { ok: true };
  });

  // There is no e-mail: the admin makes a reset link and sends it to the person.
  app.post("/api/reset", async (req, reply) => {
    if (!signupTries.allowed(`reset:${req.ip}`)) throw new HttpError(429, "too_many_attempts");
    const body = req.body as Record<string, any>;
    const password = String(body?.password ?? "");
    checkPassword(password);
    const userId = takeReset(real, String(body?.token ?? ""));
    if (!userId) {
      signupTries.hit(`reset:${req.ip}`);
      throw new HttpError(400, "reset_link_invalid");
    }
    real.saveProfile(userId, { password_hash: await hashPassword(password) });
    deleteUserSessions(real, userId);
    return { ok: true };
  });

  // ---------- Admin ----------

  function admin(req: FastifyRequest, reply: FastifyReply) {
    const v = writer(req, reply);
    if (!isAdmin(config, v.userId)) throw new HttpError(403, "forbidden");
    return v;
  }

  app.get("/api/admin/users", async (req, reply) => {
    admin(req, reply);
    const rows = real.db.prepare("SELECT user_id, data FROM profiles ORDER BY user_id").all() as { user_id: string; data: string }[];
    const days = real.db.prepare("SELECT user_id, COUNT(*) AS n, MAX(date) AS last FROM daily_entries GROUP BY user_id").all() as {
      user_id: string; n: number; last: string;
    }[];
    const byUser = new Map(days.map((d) => [d.user_id, d]));
    return {
      users: rows.map((row) => {
        const p = JSON.parse(row.data);
        const d = byUser.get(row.user_id);
        return { username: row.user_id, name: p.name ?? "", created_at: p.created_at ?? null, days: d?.n ?? 0, last_day: d?.last ?? null };
      }),
    };
  });

  app.post("/api/admin/reset-link", async (req, reply) => {
    admin(req, reply);
    const username = normalizeUserId((req.body as Record<string, any>)?.username);
    if (!username || !Object.keys(real.getProfile(username)).length) throw new HttpError(404, "not_found");
    return { url: `${origin(req)}/reset?token=${createReset(real, username)}` };
  });

  // ---------- Connecting a chat app and the Shortcut ----------

  const origin = (req: FastifyRequest) => `${req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${req.headers.host}`;
  const connectUrls = (req: FastifyRequest, token: string) => ({ mcpUrl: `${origin(req)}/mcp/${token}`, weightUrl: `${origin(req)}/api/${token}/weight` });

  app.get("/api/connect", async (req, reply) => {
    const v = writer(req, reply);
    return connectUrls(req, userToken(real, config, v.userId));
  });

  app.post("/api/connect/rotate", async (req, reply) => {
    const v = writer(req, reply);
    return connectUrls(req, rotateUserToken(real, v.userId));
  });

  app.post("/api/logout", async (req, reply) => {
    deleteSession(real, req, reply);
    clearCookie(req, reply, DEMO_COOKIE);
    return { ok: true };
  });

  app.post("/api/language", async (req, reply) => {
    const lang = String((req.body as Record<string, any>)?.lang);
    const selected = LANGS.includes(lang) ? lang : "en";
    setCookie(req, reply, LANG_COOKIE, selected, YEAR);
    const v = visitor(req, reply);
    if (v.userId && !v.demo) real.saveProfile(v.userId, { preferred_language: selected });
    return { ok: true, lang: selected };
  });

  // ---------- Demo ----------

  app.get("/demo", async (req, reply) => {
    setCookie(req, reply, DEMO_COOKIE, "1", YEAR);
    ensureDemoData(demoRepo, today());
    return reply.redirect("/?range=90d");
  });

  app.get("/demo/exit", async (req, reply) => {
    clearCookie(req, reply, DEMO_COOKIE);
    return reply.redirect((req.query as Record<string, string>).next === "register" ? "/register" : "/login");
  });

  // ---------- Dashboard ----------

  function calendarFor(v: Visitor & { userId: string }, month: string) {
    const { blanks, days } = calendar(month, v.repo.listEntries(v.userId, `${month}-01`, `${month}-31`));
    return { month, previous: shiftMonth(month, -1), next: shiftMonth(month, 1), blanks, days };
  }

  app.get("/api/dashboard", async (req, reply) => {
    const v = signedIn(req, reply);
    const query = req.query as Record<string, string>;
    const range = Object.hasOwn(RANGE_OPTIONS, query.range) ? query.range : "14d";
    const end = today();
    const dates = dateWindow(RANGE_OPTIONS[range], end);
    const entries = v.repo.listEntries(v.userId, dates[0], end);
    const weights = v.repo.listWeightLogs(v.userId, dates[0], end);
    const earlier = v.repo.listWeightLogs(v.userId, "0000-01-01", addDays(dates[0], -1));
    const previousWeight = earlier.length ? Number(earlier.at(-1)!.weight_kg) || 0 : null;
    const avg = averages(entries);
    const month = isMonth(query.month) ? query.month : end.slice(0, 7);
    return {
      range,
      rangeDays: RANGE_OPTIONS[range],
      rangeOptions: RANGE_OPTIONS,
      today: end,
      rangeLabel: dateRangeLabel(dates[0], end, v.lang),
      recordedDays: entries.length,
      trends: trendSeries(dates, entries),
      weights: weightSeries(dates, weights, previousWeight),
      totals: totals(entries),
      averages: avg,
      balance: balanceSummary(avg),
      calendar: calendarFor(v, month),
    };
  });

  app.get("/api/calendar", async (req, reply) => {
    const v = signedIn(req, reply);
    const month = (req.query as Record<string, string>).month;
    return calendarFor(v, isMonth(month) ? month : today().slice(0, 7));
  });

  // ---------- Day entry ----------

  function entryView(v: Visitor & { userId: string }, date: string) {
    const entry = v.repo.getEntry(v.userId, date);
    return { date, today: today(), entry, foodGroups: foodItemGroups(entry.analysis || {}) };
  }

  app.get("/api/entry", async (req, reply) => {
    const v = signedIn(req, reply);
    return entryView(v, isoDate((req.query as Record<string, string>).date) ?? today());
  });

  app.post("/api/entry", async (req, reply) => {
    const v = writer(req, reply);
    const body = req.body as Record<string, any>;
    const date = isoDate(body?.date) ?? today();
    const diaryText = String(body?.diary_text ?? "").trim();
    const { password_hash: _secret, ...profile } = v.repo.getProfile(v.userId);
    const analysis = await analyzeEntry(config, analyze, { diaryText, profile, entryDate: date, lang: v.lang });
    // Photos added by the earlier version stay with the day.
    const imageUrls = v.repo.getEntry(v.userId, date).image_urls || [];
    v.repo.saveEntry(v.userId, date, { diary_text: diaryText, image_urls: imageUrls, analysis });
    return entryView(v, date);
  });

  // ---------- Weight ----------

  function recordWeight(v: Visitor & { userId: string }, date: string, weightKg: number) {
    v.repo.saveWeight(v.userId, date, weightKg);
    const profile = { ...v.repo.getProfile(v.userId), weight_kg: weightKg };
    v.repo.saveProfile(v.userId, { bmr_calories: computeBmrCalories(profile, { useStored: false }) });
  }

  app.get("/api/weight", async (req, reply) => {
    const v = signedIn(req, reply);
    const end = today();
    const logs = v.repo.listWeightLogs(v.userId, addDays(end, -90), end).reverse();
    const current = logs.length ? logs[0].weight_kg : v.repo.getProfile(v.userId).weight_kg;
    return { today: end, currentWeight: current ?? null, logs: logs.map((log) => ({ date: log.date, weight_kg: log.weight_kg })) };
  });

  app.post("/api/weight", async (req, reply) => {
    const v = writer(req, reply);
    const body = req.body as Record<string, any>;
    const weightKg = parseDecimal(body?.weight_kg);
    if (weightKg === null) throw new HttpError(400, "enter_weight");
    recordWeight(v, isoDate(body?.date) ?? today(), weightKg);
    return { ok: true };
  });

  // ---------- Profile ----------

  const publicProfile = (profile: Record<string, any>) => {
    const { password_hash: _secret, ...rest } = profileWithBmr(profile);
    return rest;
  };

  app.get("/api/profile", async (req, reply) => {
    const v = signedIn(req, reply);
    return { profile: publicProfile(v.repo.getProfile(v.userId)), today: today() };
  });

  app.post("/api/profile", async (req, reply) => {
    const v = writer(req, reply);
    const body = (req.body ?? {}) as Record<string, any>;
    const payload: Record<string, any> = {
      name: String(body.name ?? "").trim(),
      age: parseWhole(body.age),
      gender: String(body.gender ?? "").trim(),
      height_cm: parseWhole(body.height_cm),
      weight_kg: parseDecimal(body.weight_kg),
      goal_weight_kg: parseDecimal(body.goal_weight_kg),
      activity_level: String(body.activity_level || "moderate"),
      goal: String(body.goal || "fat_loss"),
    };
    payload.bmr_calories = computeBmrCalories(payload, { useStored: false });
    payload.profile_complete = profileComplete(payload);
    v.repo.saveProfile(v.userId, payload);
    if (payload.weight_kg) v.repo.saveWeight(v.userId, today(), payload.weight_kg);
    return { ok: true, complete: payload.profile_complete, profile: publicProfile(v.repo.getProfile(v.userId)) };
  });

  // ---------- Photos from the earlier version ----------

  // Only the person whose day a photo belongs to may see it.
  const uploads = resolve(config.uploadDir);
  mkdirSync(uploads, { recursive: true });
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/uploads/")) return;
    const v = visitor(req, reply);
    const path = req.url.split("?")[0];
    const owns =
      v.userId && !v.demo &&
      real.db.prepare("SELECT 1 FROM daily_entries WHERE user_id = ? AND instr(data, ?) > 0 LIMIT 1").get(v.userId, JSON.stringify(path));
    if (!owns) return reply.status(404).send({ error: "not_found" });
  });
  await app.register(fastifyStatic, { root: uploads, prefix: "/uploads/", decorateReply: false, index: false });

  // ---------- Pages ----------

  const PAGES = new Set(["/", "/entry", "/weight", "/profile", "/login", "/register", "/reset"]);
  const OPEN_PAGES = new Set(["/login", "/register", "/reset"]);
  const dist = resolve(distDir);
  const hasDist = existsSync(resolve(dist, "index.html"));
  if (hasDist) await app.register(fastifyStatic, { root: dist, wildcard: false, index: false });

  /** Pages need a login. First-time visitors land on the demo; anyone who has seen a real page gets the login page. */
  async function page(req: FastifyRequest, reply: FastifyReply) {
    const path = req.url.split("?")[0];
    const v = visitor(req, reply);
    if (!v.userId && !OPEN_PAGES.has(path)) {
      if (!readCookie(req, VISITED_COOKIE)) return reply.redirect("/demo");
      return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
    }
    if (!v.demo && !readCookie(req, VISITED_COOKIE)) setCookie(req, reply, VISITED_COOKIE, "1", TEN_YEARS);
    reply.header("Cache-Control", "no-cache");
    if (!hasDist) return reply.type("text/html").send("<!doctype html><title>MyDiet</title><p>Run <code>npm run build</code> first.");
    return reply.sendFile("index.html", dist);
  }

  for (const path of PAGES) app.get(path, page);

  // Built assets are named by their content, so browsers may keep them; everything else is checked each time.
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/assets/")) reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return payload;
  });

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    if (req.method === "GET" && !path.startsWith("/api/") && !path.startsWith("/mcp/") && !/\.\w+$/.test(path)) return reply.redirect("/");
    return reply.status(404).send({ error: "not_found" });
  });

  return app;
}

// ---------- Helpers ----------

function parseBody(contentType: string, body: string): unknown {
  if (!body) return undefined;
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(body));
  if (contentType.includes("multipart/form-data")) return parseMultipart(contentType, body);
  try {
    return JSON.parse(body);
  } catch {
    return contentType.includes("json") ? undefined : body;
  }
}

/** The text fields of a multipart form (an iPhone Shortcut may post its "Form" body this way). */
function parseMultipart(contentType: string, body: string): Record<string, string> {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  const fields: Record<string, string> = {};
  if (!boundary) return fields;
  for (const part of body.split(`--${boundary}`)) {
    const split = part.indexOf("\r\n\r\n");
    if (split < 0) continue;
    const name = /name="([^"]*)"/i.exec(part.slice(0, split))?.[1];
    if (name !== undefined) fields[name] = part.slice(split + 4).replace(/\r\n$/, "");
  }
  return fields;
}

/** "82.4" or "82,4" (Turkish keyboards) as a number; null when empty or not a number. */
function parseDecimal(value: unknown): number | null {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function parseWhole(value: unknown): number | null {
  const n = parseDecimal(value);
  return n === null ? null : Math.trunc(n);
}

export { toFloat };
