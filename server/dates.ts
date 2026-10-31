// Days are "YYYY-MM-DD" strings; "today" is the user's local day.

export function localDate(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The `days` days ending on `end` (inclusive), oldest first. */
export function dateWindow(days: number, end: string): string[] {
  return Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));
}

/** Every day of the month "YYYY-MM". */
export function monthWindow(month: string): string[] {
  const first = `${month}-01`;
  const out: string[] = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) out.push(d);
  return out;
}

export function shiftMonth(month: string, offset: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + offset;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Monday = 0 … Sunday = 6, like Python's weekday(). */
export function weekday(date: string): number {
  return (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
}

/** A real calendar day as YYYY-MM-DD, or null. */
export function isoDate(value: unknown): string | null {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(text + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? text : null;
}

export const isMonth = (value: unknown) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const TR_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

const parts = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
};

/** "October 18-31, 2026" / "18-31 Ekim 2026", and the longer forms across months and years. */
export function dateRangeLabel(start: string, end: string, lang: string): string {
  const s = parts(start);
  const e = parts(end);
  if (lang === "tr") {
    if (s.y === e.y && s.m === e.m) return `${s.d}-${e.d} ${TR_MONTHS[s.m - 1]} ${e.y}`;
    if (s.y === e.y) return `${s.d} ${TR_SHORT[s.m - 1]} - ${e.d} ${TR_SHORT[e.m - 1]} ${e.y}`;
    return `${s.d} ${TR_SHORT[s.m - 1]} ${s.y} - ${e.d} ${TR_SHORT[e.m - 1]} ${e.y}`;
  }
  const short = (m: number) => EN_MONTHS[m - 1].slice(0, 3);
  if (s.y === e.y && s.m === e.m) return `${EN_MONTHS[s.m - 1]} ${s.d}-${e.d}, ${e.y}`;
  if (s.y === e.y) return `${short(s.m)} ${s.d} - ${short(e.m)} ${e.d}, ${e.y}`;
  return `${short(s.m)} ${s.d}, ${s.y} - ${short(e.m)} ${e.d}, ${e.y}`;
}
