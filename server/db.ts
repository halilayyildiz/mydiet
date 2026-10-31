// Each profile, day and weight log is a JSON document in a local SQLite file (same tables the Flask app used).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Doc = Record<string, any>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_entries (
  user_id TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS weight_logs (
  user_id TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, date)
);
-- Login sessions; only a SHA-256 of each token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
`;

const isoNow = () => new Date().toISOString().replace("Z", "+00:00");

export class Repo {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 10_000 } as any);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  getProfile(userId: string): Doc {
    const row = this.db.prepare("SELECT data FROM profiles WHERE user_id = ?").get(userId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : {};
  }

  saveProfile(userId: string, payload: Doc) {
    const profile = { ...this.getProfile(userId), ...payload, updated_at: isoNow() };
    this.db
      .prepare("INSERT INTO profiles (user_id, data) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data")
      .run(userId, JSON.stringify(profile));
  }

  getEntry(userId: string, date: string): Doc {
    const row = this.db.prepare("SELECT data FROM daily_entries WHERE user_id = ? AND date = ?").get(userId, date) as
      | { data: string }
      | undefined;
    return row ? { ...JSON.parse(row.data), id: date } : {};
  }

  saveEntry(userId: string, date: string, payload: Doc) {
    this.put("daily_entries", userId, date, { ...payload, date, updated_at: isoNow() });
  }

  listEntries(userId: string, start: string, end: string): Doc[] {
    return this.range("daily_entries", userId, start, end);
  }

  listAllEntries(userId: string): Doc[] {
    return this.range("daily_entries", userId, "0000-00-00", "9999-99-99");
  }

  updateEntryAnalysis(userId: string, date: string, analysis: Doc) {
    const { id: _id, ...entry } = this.getEntry(userId, date);
    this.put("daily_entries", userId, date, { ...entry, date, analysis, updated_at: isoNow() });
  }

  listWeightLogs(userId: string, start: string, end: string): Doc[] {
    return this.range("weight_logs", userId, start, end);
  }

  saveWeight(userId: string, date: string, weightKg: number) {
    this.put("weight_logs", userId, date, { date, weight_kg: weightKg, updated_at: isoNow() });
    this.saveProfile(userId, { weight_kg: weightKg });
  }

  /** Deletes everything stored for a user (used to rebuild the demo). */
  clearUser(userId: string) {
    for (const table of ["profiles", "daily_entries", "weight_logs"]) this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private put(table: string, userId: string, date: string, data: Doc) {
    this.db
      .prepare(`INSERT INTO ${table} (user_id, date, data) VALUES (?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET data = excluded.data`)
      .run(userId, date, JSON.stringify(data));
  }

  private range(table: string, userId: string, start: string, end: string): Doc[] {
    const rows = this.db
      .prepare(`SELECT date, data FROM ${table} WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date`)
      .all(userId, start, end) as { date: string; data: string }[];
    return rows.map((row) => ({ ...JSON.parse(row.data), id: row.date }));
  }
}
