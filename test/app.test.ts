import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../server/app.ts";
import { loadConfig, type Config } from "../server/config.ts";
import { hashPassword, readFlaskSession, verifyPassword } from "../server/auth.ts";
import { Repo } from "../server/db.ts";
import { localDate } from "../server/dates.ts";
import { analysisPrompt } from "../server/claude.ts";
import { shortcutWeight } from "../server/mcp.ts";
import { computeBmrCalories, roundHalfEven } from "../server/nutrition.ts";

// Made by werkzeug / Flask (the old app) for "pässword1" and the secret "flasksecret".
const WERKZEUG = {
  scrypt: "scrypt:32768:8:1$RXcpXy57WjHorhlB$f29b5b7e9a995cbd075a3ddb5813a5638e267cfa843715522d0158aac38a66a053309314f98d5756b8b701358603222573e5aa89de53a2fc38ee4a4b9c519b5e",
  pbkdf2: "pbkdf2:sha256:1000$7N1SNrx1fSEfjPkp$859c3ccac42a19507ea4db1fa530c19e9e04aca8151e0fbd1014afd1a29ed692",
};
const FLASK_COOKIES = {
  plain: "eyJhdXRoZW50aWNhdGVkIjp0cnVlLCJ1c2VyX2lkIjoiaGFsaWwiLCJsYW5nIjoidHIiLCJfcGVybWFuZW50Ijp0cnVlfQ.auXvBQ.8aL4g9UEEr_Z_jJ4nJ3Ft8fOSsM",
  compressed: ".eJyrVkosLclIzSvJTE4sSU1RsiopKk3VUSotTi2KzwRylTISczJzlHSUchLz0oHc1DwguyARJFMxCgYVUKoFAEUKz4M.auXvBQ.zdJNwMlOrrbVAW8PLJqKVteAzJ0",
  demo: "eyJhdXRoZW50aWNhdGVkIjp0cnVlLCJ1c2VyX2lkIjoiZGVtbyIsImRlbW8iOnRydWV9.auXvBQ.51t-TX3_DbojL2OzWEKCj8QDYBw",
};

function testConfig(overrides: Partial<Config> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), "mydiet-"));
  return loadConfig({}, {
    dbPath: join(dir, "mydiet.db"),
    demoDbPath: join(dir, "demo.db"),
    uploadDir: join(dir, "uploads"),
    mcpToken: "secret-token",
    flaskSecretKey: "flasksecret",
    ...overrides,
  });
}

async function setup(overrides: Partial<Config> = {}, analyzer: any = null) {
  const config = testConfig(overrides);
  const app = await buildApp({ config, analyzer, distDir: join(config.uploadDir, "no-dist") });
  return { app, config, repo: new Repo(config.dbPath) };
}

/** Cookies from a response, as a Cookie header. */
function cookies(res: { headers: Record<string, any> }, jar: Record<string, string> = {}) {
  const set = res.headers["set-cookie"];
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [pair, ...attrs] = String(c).split(";");
    const [name, value] = pair.split("=");
    if (attrs.some((a) => a.trim() === "Max-Age=0")) delete jar[name];
    else jar[name] = value;
  }
  return jar;
}
const header = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

const COMPLETE_PROFILE = { age: 40, gender: "male", height_cm: 180, weight_kg: 90, activity_level: "low", goal: "fat_loss" };

async function login(app: any, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { username, password } });
  return { res, jar: cookies(res) };
}

test("passwords: werkzeug, Wealth Tracker and new hashes", async () => {
  assert.equal(await verifyPassword("pässword1", WERKZEUG.scrypt), true);
  assert.equal(await verifyPassword("pässword2", WERKZEUG.scrypt), false);
  assert.equal(await verifyPassword("pässword1", WERKZEUG.pbkdf2), true);
  assert.equal(await verifyPassword("nope", WERKZEUG.pbkdf2), false);
  const ours = await hashPassword("hunter22");
  assert.match(ours, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword("hunter22", ours), true);
  assert.equal(await verifyPassword("hunter23", ours), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("Flask cookies: valid ones are read, tampered ones are not", () => {
  assert.deepEqual(readFlaskSession(FLASK_COOKIES.plain, "flasksecret")?.user_id, "halil");
  assert.equal(readFlaskSession(FLASK_COOKIES.compressed, "flasksecret")?.pad, "x".repeat(400));
  assert.equal(readFlaskSession(FLASK_COOKIES.plain, "other-secret"), null);
  assert.equal(readFlaskSession(FLASK_COOKIES.plain.replace("eyJ", "eyK"), "flasksecret"), null);
  assert.equal(readFlaskSession(FLASK_COOKIES.plain, "flasksecret", 0), null, "too old");
});

test("a Flask login cookie becomes a new session", async () => {
  const { app, repo } = await setup();
  const res = await app.inject({ url: "/api/session", headers: { cookie: `session=${FLASK_COOKIES.plain}` } });
  assert.equal(res.json().authenticated, true);
  assert.equal(res.json().username, "halil");
  assert.equal(res.json().lang, "tr");
  const jar = cookies(res);
  assert.ok(jar.mydiet_session);
  assert.equal(jar.mydiet_lang, "tr");
  assert.equal(jar.session, undefined, "old cookie cleared");
  // The new session works on its own.
  const again = await app.inject({ url: "/api/session", headers: { cookie: header(jar) } });
  assert.equal(again.json().username, "halil");
  assert.equal((repo.db.prepare("SELECT count(*) n FROM sessions").get() as { n: number }).n, 1);
  // A demo visitor's Flask cookie doesn't sign anyone in.
  const demo = await app.inject({ url: "/api/session", headers: { cookie: `session=${FLASK_COOKIES.demo}` } });
  assert.equal(demo.json().authenticated, false);
});

test("login with APP_PASSWORD_HASH, per-account hashes, wrong passwords and lockout", async () => {
  const { app, repo } = await setup({ appPasswordHash: WERKZEUG.scrypt });
  repo.saveProfile("halil", COMPLETE_PROFILE);
  assert.equal((await login(app, "halil", "wrong")).res.statusCode, 401);
  const ok = await login(app, " Halil ", "pässword1");
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.res.json().needsProfile, false);
  assert.match(String(ok.res.headers["set-cookie"]), /mydiet_session=.*Max-Age=31536000/);
  const session = await app.inject({ url: "/api/session", headers: { cookie: header(ok.jar) } });
  assert.equal(session.json().username, "halil");

  repo.saveProfile("ayse", { password_hash: WERKZEUG.pbkdf2 });
  const ayse = await login(app, "ayse", "pässword1");
  assert.equal(ayse.res.json().needsProfile, true);
  // Other users can't use the single-user password.
  assert.equal((await login(app, "mehmet", "pässword1")).res.statusCode, 401);
  for (let i = 0; i < 5; i++) await login(app, "halil", "wrong");
  assert.equal((await login(app, "halil", "pässword1")).res.statusCode, 429);
});

test("logout ends the session", async () => {
  const { app, repo } = await setup({ appPassword: "pw" });
  repo.saveProfile("halil", COMPLETE_PROFILE);
  const { jar } = await login(app, "halil", "pw");
  const out = await app.inject({ method: "POST", url: "/api/logout", headers: { cookie: header(jar) } });
  assert.equal(out.statusCode, 200);
  const after = await app.inject({ url: "/api/session", headers: { cookie: header(jar) } });
  assert.equal(after.json().authenticated, false);
  assert.equal((await app.inject({ url: "/api/dashboard", headers: { cookie: header(jar) } })).statusCode, 401);
});

test("sessions slide forward: an old session gets a fresh year", async () => {
  const { app, repo } = await setup({ appPassword: "pw" });
  const { jar } = await login(app, "halil", "pw");
  const soon = new Date(Date.now() + 10 * 86400_000).toISOString();
  repo.db.prepare("UPDATE sessions SET expires_at = ?").run(soon);
  const res = await app.inject({ url: "/api/session", headers: { cookie: header(jar) } });
  assert.equal(res.json().authenticated, true);
  assert.match(String(res.headers["set-cookie"]), /mydiet_session=.*Max-Age=31536000/);
  const row = repo.db.prepare("SELECT expires_at FROM sessions").get() as { expires_at: string };
  assert.ok(Date.parse(row.expires_at) > Date.now() + 360 * 86400_000);
  repo.db.prepare("UPDATE sessions SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await app.inject({ url: "/api/session", headers: { cookie: header(jar) } })).json().authenticated, false);
});

test("register creates an account that can sign in; bad input is refused", async () => {
  const { app } = await setup();
  const reg = (username: string, password: string) => app.inject({ method: "POST", url: "/api/register", payload: { username, password } });
  assert.equal((await reg("x", "pw")).json().error, "invalid_username");
  assert.equal((await reg("newuser", "")).json().error, "invalid_password");
  assert.equal((await reg("NewUser", "pw123")).statusCode, 200);
  assert.equal((await reg("newuser", "pw123")).json().error, "user_already_exists");
  const { res } = await login(app, "newuser", "pw123");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().needsProfile, true);
});

test("pages: first visit goes to the demo, later visits to the login page", async () => {
  const { app } = await setup({ appPassword: "pw" });
  const first = await app.inject({ url: "/" });
  assert.equal(first.statusCode, 302);
  assert.equal(first.headers.location, "/demo");
  const loginPage = await app.inject({ url: "/login" });
  assert.equal(loginPage.statusCode, 200);
  const jar = cookies(loginPage);
  assert.equal(jar.mydiet_visited, "1");
  const later = await app.inject({ url: "/weight?x=1", headers: { cookie: header(jar) } });
  assert.equal(later.headers.location, "/login?next=%2Fweight%3Fx%3D1");
  // API routes answer 401 rather than redirecting.
  assert.equal((await app.inject({ url: "/api/weight" })).statusCode, 401);
});

test("demo: English by default, made-up data, read-only, and the real data stays untouched", async () => {
  const { app, repo, config } = await setup({ appPassword: "pw" });
  const enter = await app.inject({ url: "/demo" });
  assert.equal(enter.statusCode, 302);
  assert.equal(enter.headers.location, "/?range=90d");
  const jar = cookies(enter);
  assert.equal(jar.mydiet_demo, "1");
  const session = (await app.inject({ url: "/api/session", headers: { cookie: header(jar) } })).json();
  assert.deepEqual([session.authenticated, session.demo, session.lang, session.username], [true, true, "en", "demo"]);
  const dash = (await app.inject({ url: "/api/dashboard?range=90d", headers: { cookie: header(jar) } })).json();
  assert.equal(dash.recordedDays, 90);
  assert.equal(dash.trends.at(-1).date, localDate(config.timezone));
  assert.ok(dash.weights.at(0).weight > dash.weights.at(-1).weight, "the demo loses weight");
  const page = await app.inject({ url: "/", headers: { cookie: header(jar) } });
  assert.equal(page.statusCode, 200);
  assert.equal(cookies(page).mydiet_visited, undefined, "the demo doesn't count as a visit");
  for (const [url, payload] of [["/api/entry", { diary_text: "x" }], ["/api/weight", { weight_kg: "80" }], ["/api/profile", COMPLETE_PROFILE]] as const) {
    const res = await app.inject({ method: "POST", url, payload, headers: { cookie: header(jar) } });
    assert.equal(res.statusCode, 403, url);
    assert.equal(res.json().error, "demo_read_only");
  }
  assert.equal(repo.listAllEntries("demo").length, 0, "nothing in the real database");
  const exit = await app.inject({ url: "/demo/exit", headers: { cookie: header(jar) } });
  assert.equal(exit.headers.location, "/login");
  assert.equal(cookies(exit, { ...jar }).mydiet_demo, undefined);
});

test("profile gate, profile save and BMR", async () => {
  const { app, repo } = await setup({ appPassword: "pw" });
  const { res, jar } = await login(app, "halil", "pw");
  assert.equal(res.json().needsProfile, true);
  const save = await app.inject({
    method: "POST", url: "/api/profile", headers: { cookie: header(jar) },
    payload: { name: " Halil ", age: "40", gender: "male", height_cm: "180", weight_kg: "90,5", goal_weight_kg: "", activity_level: "moderate", goal: "fat_loss" },
  });
  assert.equal(save.json().complete, true);
  const profile = repo.getProfile("halil");
  assert.equal(profile.name, "Halil");
  assert.equal(profile.weight_kg, 90.5);
  assert.equal(profile.goal_weight_kg, null);
  assert.equal(profile.bmr_calories, roundHalfEven((10 * 90.5 + 6.25 * 180 - 5 * 40 + 5) * 1.25));
  assert.equal(repo.listWeightLogs("halil", "0000", "9999").length, 1);
  assert.equal((await app.inject({ url: "/api/session", headers: { cookie: header(jar) } })).json().needsProfile, false);
  const view = (await app.inject({ url: "/api/profile", headers: { cookie: header(jar) } })).json();
  assert.equal(view.profile.password_hash, undefined);
});

test("day entry: Claude's analysis is stored; without Claude a rough estimate", async () => {
  const seen: any[] = [];
  const fake = async (args: any) => {
    seen.push(args);
    return { food_calories: 1800.4, food_items: [{ name: "Menemen", meal: "morning", calories: 400.5, protein_g: 20, carbs_g: 10, fat_g: 30 }],
      bmr_calories: 2100, activity_calories: 300, burned_calories: 2400, calorie_deficit: 600, protein_g: 20, carbs_g: 10, fat_g: 30,
      confidence: "high", summary: "İyi gün", assumptions: ["tahmini"] };
  };
  const { app, repo } = await setup({ appPassword: "pw" }, fake);
  repo.saveProfile("halil", { ...COMPLETE_PROFILE, password_hash: WERKZEUG.pbkdf2 });
  repo.saveEntry("halil", "2026-10-30", { diary_text: "old", image_urls: ["/uploads/a.jpg"], analysis: {} });
  const { jar } = await login(app, "halil", "pässword1");
  const lang = await app.inject({ method: "POST", url: "/api/language", payload: { lang: "tr" }, headers: { cookie: header(jar) } });
  cookies(lang, jar);
  const res = await app.inject({ method: "POST", url: "/api/entry", payload: { date: "2026-10-30", diary_text: "  menemen  " }, headers: { cookie: header(jar) } });
  const body = res.json();
  assert.equal(body.entry.analysis.food_calories, 1800);
  assert.equal(body.entry.analysis.food_items[0].calories, 400, "halves round to even, like the old app");
  assert.deepEqual(body.entry.image_urls, ["/uploads/a.jpg"]);
  assert.equal(body.foodGroups[0].key, "morning");
  assert.equal(seen[0].diaryText, "menemen");
  assert.equal(seen[0].lang, "tr");
  assert.equal(seen[0].profile.password_hash, undefined);
  assert.equal(repo.getProfile("halil").preferred_language, "tr");

  const { app: app2, repo: repo2 } = await setup({ appPassword: "pw" }, null);
  repo2.saveProfile("halil", COMPLETE_PROFILE);
  const j2 = (await login(app2, "halil", "pw")).jar;
  const rough = (await app2.inject({ method: "POST", url: "/api/entry", payload: { date: "2026-10-29", diary_text: "breakfast and a walk" }, headers: { cookie: header(j2) } })).json();
  assert.equal(rough.entry.analysis.confidence, "low");
  assert.equal(rough.entry.analysis.food_calories, 450);
  assert.equal(rough.entry.analysis.activity_calories, 120);
  assert.match(rough.entry.analysis.assumptions[0], /ANTHROPIC_API_KEY/);

  const failing = async () => { throw new Error("boom"); };
  const { app: app3, repo: repo3 } = await setup({ appPassword: "pw" }, failing);
  repo3.saveProfile("halil", COMPLETE_PROFILE);
  const j3 = (await login(app3, "halil", "pw")).jar;
  const failed = (await app3.inject({ method: "POST", url: "/api/entry", payload: { diary_text: "lunch" }, headers: { cookie: header(j3) } })).json();
  assert.equal(failed.entry.analysis.summary, "Claude analysis failed: boom");
});

test("weight form: comma decimals, BMR follows the weight", async () => {
  const { app, repo } = await setup({ appPassword: "pw" });
  repo.saveProfile("halil", COMPLETE_PROFILE);
  const { jar } = await login(app, "halil", "pw");
  assert.equal((await app.inject({ method: "POST", url: "/api/weight", payload: { weight_kg: " " }, headers: { cookie: header(jar) } })).json().error, "enter_weight");
  await app.inject({ method: "POST", url: "/api/weight", payload: { date: "2026-10-30", weight_kg: "88,2" }, headers: { cookie: header(jar) } });
  assert.equal(repo.getProfile("halil").weight_kg, 88.2);
  assert.equal(repo.getProfile("halil").bmr_calories, computeBmrCalories({ ...COMPLETE_PROFILE, weight_kg: 88.2 }, { useStored: false }));
  const view = (await app.inject({ url: "/api/weight", headers: { cookie: header(jar) } })).json();
  assert.equal(view.currentWeight, 88.2);
});

test("calendar months and dashboard ranges", async () => {
  const { app, repo } = await setup({ appPassword: "pw" });
  repo.saveProfile("halil", COMPLETE_PROFILE);
  repo.saveEntry("halil", "2026-02-10", { analysis: { calorie_deficit: -250 } });
  const { jar } = await login(app, "halil", "pw");
  const cal = (await app.inject({ url: "/api/calendar?month=2026-02", headers: { cookie: header(jar) } })).json();
  assert.equal(cal.days.length, 28);
  assert.equal(cal.blanks, 6, "Feb 1st 2026 is a Sunday");
  assert.deepEqual([cal.previous, cal.next], ["2026-01", "2026-03"]);
  assert.equal(cal.days[9].tone, "bad");
  const dash = (await app.inject({ url: "/api/dashboard?range=365d", headers: { cookie: header(jar) } })).json();
  assert.equal(dash.trends.length, 365);
  assert.equal((await app.inject({ url: "/api/dashboard?range=bogus", headers: { cookie: header(jar) } })).json().range, "14d");
});

test("shortcut weights and the analysis prompt", () => {
  assert.equal(shortcutWeight(82.4), 82.4);
  assert.equal(shortcutWeight("82,4"), 82.4);
  assert.equal(shortcutWeight("181 lb"), 82.1);
  assert.throws(() => shortcutWeight("abc"));
  const config = loadConfig({}, {});
  const prompt = analysisPrompt(config, "menemen", { age: 40 }, "2026-10-30", "tr");
  assert.match(prompt, /Output language: Turkish/);
  assert.match(prompt, /"food_calories": number/);
  assert.match(prompt, /Profile JSON: \{"age":40\}/);
  assert.ok(prompt.endsWith("menemen"));
});

test("health check", async () => {
  const { app } = await setup();
  assert.deepEqual((await app.inject({ url: "/api/health" })).json(), { ok: true });
});
