// The numbers behind the dashboard: chart series, averages, the energy-balance card and the calendar.
import { addDays, monthWindow, weekday } from "./dates.ts";
import { computeBmrCalories, roundHalfEven, toInt } from "./nutrition.ts";

type Doc = Record<string, any>;

const int = (value: unknown) => Math.trunc(Number(value) || 0);

export function analysisBasal(analysis: Doc): number {
  if (analysis.bmr_calories) return int(analysis.bmr_calories);
  return Math.max(int(analysis.burned_calories) - int(analysis.activity_calories), 0);
}

export function trendSeries(dates: string[], entries: Doc[]) {
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  return dates.map((date) => {
    const entry = byDate.get(date);
    if (!entry) return { date, has_data: false };
    const analysis = entry.analysis || {};
    return {
      date,
      has_data: true,
      food: int(analysis.food_calories),
      basal: analysisBasal(analysis),
      burned: int(analysis.burned_calories),
      activity: int(analysis.activity_calories),
      deficit: int(analysis.calorie_deficit),
    };
  });
}

/** One row per day; days without a weigh-in carry the last known weight so the line is continuous. */
export function weightSeries(dates: string[], weights: Doc[], previousWeight: number | null) {
  const byDate = new Map(weights.map((item) => [item.date, item]));
  let last: number | null = previousWeight || null;
  return dates.map((date) => {
    const item = byDate.get(date);
    if (!item || !item.weight_kg) return last ? { date, has_data: false, weight: last } : { date, has_data: false };
    last = Number(item.weight_kg) || 0;
    return { date, has_data: true, weight: last };
  });
}

export function totals(entries: Doc[]) {
  const sum = { food: 0, basal: 0, burned: 0, activity: 0, deficit: 0 };
  for (const entry of entries) {
    const analysis = entry.analysis || {};
    sum.food += int(analysis.food_calories);
    sum.basal += analysisBasal(analysis);
    sum.burned += int(analysis.burned_calories);
    sum.activity += int(analysis.activity_calories);
    sum.deficit += int(analysis.calorie_deficit);
  }
  return sum;
}

export function averages(entries: Doc[]) {
  const sum = totals(entries);
  const divisor = Math.max(entries.length, 1);
  return Object.fromEntries(Object.entries(sum).map(([key, value]) => [key, roundHalfEven(value / divisor)])) as typeof sum;
}

export function balanceSummary(avg: ReturnType<typeof averages>) {
  const food = Math.max(avg.food || 0, 0);
  const burned = Math.max(avg.burned || 0, 0);
  const activity = Math.max(avg.activity || 0, 0);
  const basal = Math.max(avg.basal || burned - activity, 0);
  const deficit = avg.deficit || burned - food;
  const weeklyKg = (deficit * 7) / 7700;
  const max = Math.max(food, burned, 1);
  return {
    food,
    burned,
    activity,
    basal,
    deficit,
    weekly_kg: weeklyKg,
    food_pct: roundHalfEven((food / max) * 100),
    burned_pct: roundHalfEven((burned / max) * 100),
    basal_pct: roundHalfEven((basal / max) * 100),
    activity_pct: roundHalfEven((Math.min(activity, burned) / max) * 100),
  };
}

const tone = (deficit: number) => (deficit > 0 ? "good" : deficit < 0 ? "bad" : "neutral");

/** The month's days (with blanks before the 1st so weeks start on Monday) and each day's deficit. */
export function calendar(month: string, entries: Doc[]) {
  const dates = monthWindow(month);
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const days = dates.map((date) => {
    const analysis = byDate.get(date)?.analysis || {};
    const deficit = int(analysis.calorie_deficit);
    const logged = Object.keys(analysis).length > 0;
    return { date, day: Number(date.slice(8)), deficit, logged, tone: logged ? tone(deficit) : "empty" };
  });
  return { blanks: weekday(dates[0]), days };
}

export function profileWithBmr(profile: Doc): Doc {
  if (profile.bmr_calories) return profile;
  return { ...profile, bmr_calories: computeBmrCalories(profile) };
}

export const dayBefore = (date: string) => addDays(date, -1);
export { toInt };
