// Calorie math shared by the web form, the Claude connector and the demo.

export type FoodItem = { name: string; meal: Meal; calories: number; protein_g: number; carbs_g: number; fat_g: number };
export type Meal = "morning" | "lunch" | "dinner" | "snacks";
export type Analysis = {
  food_calories: number;
  food_items: FoodItem[];
  bmr_calories: number;
  activity_calories: number;
  burned_calories: number;
  calorie_deficit: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: string;
  summary: string;
  assumptions: string[];
};
export type Profile = Record<string, any>;

export const RANGE_OPTIONS: Record<string, number> = { "14d": 14, "30d": 30, "90d": 90, "365d": 365 };

const BMR_ACTIVITY_MULTIPLIERS: Record<string, number> = { low: 1.1, moderate: 1.25, high: 1.45 };
export const MEALS: Meal[] = ["morning", "lunch", "dinner", "snacks"];

/** Python's round(): halves go to the even neighbour, so totals match what the old app stored. */
export function roundHalfEven(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x);
}

/** A whole number from anything number-like; 0 otherwise. */
export function toInt(value: unknown): number {
  if (value === null || value === undefined || value === "" || typeof value === "boolean" && !value) return 0;
  const n = typeof value === "boolean" ? 1 : Number(value);
  return Number.isFinite(n) ? roundHalfEven(n) : 0;
}

export function toFloat(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.trim());
}

export function mealKey(value: unknown): Meal {
  const text = String(value ?? "").trim().toLowerCase();
  if (["morning", "breakfast", "sabah"].includes(text)) return "morning";
  if (["lunch", "noon", "oglen", "öğlen"].includes(text)) return "lunch";
  if (["dinner", "evening", "aksam", "akşam"].includes(text)) return "dinner";
  if (["snack", "snacks", "atistirmalik", "atıştırmalık", "atistirmaliklar", "atıştırmalıklar"].includes(text)) return "snacks";
  const has = (words: string[]) => words.some((word) => text.includes(word));
  if (has(["breakfast", "morning", "coffee"])) return "morning";
  if (has(["lunch", "noon"])) return "lunch";
  if (has(["dinner", "evening"])) return "dinner";
  return "snacks";
}

export function foodItems(value: unknown): FoodItem[] {
  if (!Array.isArray(value)) return [];
  const items: FoodItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    items.push({
      name,
      meal: mealKey(item.meal || name),
      calories: toInt(item.calories),
      protein_g: toInt(item.protein_g),
      carbs_g: toInt(item.carbs_g),
      fat_g: toInt(item.fat_g),
    });
  }
  return items;
}

export function normalizeAnalysis(payload: Record<string, any>): Analysis {
  return {
    food_calories: toInt(payload.food_calories),
    food_items: foodItems(payload.food_items),
    bmr_calories: toInt(payload.bmr_calories),
    activity_calories: toInt(payload.activity_calories),
    burned_calories: toInt(payload.burned_calories),
    calorie_deficit: toInt(payload.calorie_deficit),
    protein_g: toInt(payload.protein_g),
    carbs_g: toInt(payload.carbs_g),
    fat_g: toInt(payload.fat_g),
    confidence: String(payload.confidence || "medium"),
    summary: String(payload.summary || ""),
    assumptions: stringList(payload.assumptions),
  };
}

/** The day's foods grouped by meal, in meal order, leaving out empty meals. */
export function foodItemGroups(analysis: Record<string, any>) {
  const groups = MEALS.map((key) => ({ key, calories: 0, items: [] as FoodItem[] }));
  for (const item of foodItems(analysis.food_items)) {
    const group = groups.find((g) => g.key === mealKey(item.meal || item.name))!;
    group.calories += item.calories;
    group.items.push(item);
  }
  return groups.filter((group) => group.items.length);
}

/** Profile-based daily burn: Mifflin-St Jeor times the everyday activity level (exercise comes on top). */
export function computeBmrCalories(profile: Profile, { useStored = true } = {}): number {
  const stored = toInt(profile.bmr_calories);
  if (useStored && stored) return stored;
  const weight = toFloat(profile.weight_kg) || 80;
  const height = toFloat(profile.height_cm) || 175;
  const age = toFloat(profile.age) || 35;
  const gender = String(profile.gender ?? "").toLowerCase();
  const raw = 10 * weight + 6.25 * height - 5 * age + (gender === "male" ? 5 : -161);
  const level = String(profile.activity_level || "low").toLowerCase();
  return roundHalfEven(raw * (BMR_ACTIVITY_MULTIPLIERS[level] ?? BMR_ACTIVITY_MULTIPLIERS.low));
}

/** An analysis built from calories already worked out elsewhere (e.g. a Claude chat). */
export function analysisFromItems(
  profile: Profile,
  opts: { foodItems: unknown; activityCalories?: unknown; burnedCalories?: unknown; summary?: string; assumptions?: unknown },
): Analysis {
  const items = foodItems(opts.foodItems);
  const food = items.reduce((sum, item) => sum + item.calories, 0);
  const activity = toInt(opts.activityCalories);
  const bmr = computeBmrCalories(profile);
  const burned = toInt(opts.burnedCalories) || roundHalfEven(Math.max(bmr + activity, 1200));
  return {
    food_calories: food,
    food_items: items,
    bmr_calories: bmr,
    activity_calories: activity,
    burned_calories: burned,
    calorie_deficit: burned - food,
    protein_g: items.reduce((sum, item) => sum + item.protein_g, 0),
    carbs_g: items.reduce((sum, item) => sum + item.carbs_g, 0),
    fat_g: items.reduce((sum, item) => sum + item.fat_g, 0),
    confidence: "high",
    summary: opts.summary ?? "",
    assumptions: stringList(opts.assumptions),
  };
}

/** Rough placeholder numbers, used when Claude isn't configured or fails. */
export function fallbackAnalysis(diaryText: string, profile: Profile, reason: string, lang: string): Analysis {
  const bmr = computeBmrCalories(profile);
  const food = roughFoodCalories(diaryText);
  const activity = roughActivityCalories(diaryText);
  const burned = roundHalfEven(Math.max(bmr + activity, 1200));
  return {
    food_calories: food,
    food_items: roughFoodItems(diaryText, food),
    bmr_calories: bmr,
    activity_calories: activity,
    burned_calories: burned,
    calorie_deficit: burned - food,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    confidence: "low",
    summary:
      lang === "tr"
        ? "Claude analizi olmadan kaydedildi. Değerler yaklaşık yer tutuculardır."
        : "Saved without Claude analysis. Values are rough placeholders.",
    assumptions: [reason],
  };
}

function roughFoodItems(text: string, total: number): FoodItem[] {
  if (!total) return [];
  const lowered = text.toLowerCase();
  let labels = ["breakfast", "lunch", "dinner", "snack"].filter((word) => lowered.includes(word));
  if (!labels.length) labels = ["food notes"];
  const calories = roundHalfEven(total / labels.length);
  return labels.map((label) => ({
    name: label.replace(/\b\w/g, (c) => c.toUpperCase()),
    meal: mealKey(label),
    calories,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
  }));
}

function roughFoodCalories(text: string): number {
  const lowered = text.toLowerCase();
  if (["kcal", "calorie", "calories"].some((marker) => lowered.includes(marker))) return 0;
  return ["breakfast", "lunch", "dinner", "snack", "meal", "ate", "food"].filter((word) => lowered.includes(word)).length * 450;
}

function roughActivityCalories(text: string): number {
  const lowered = text.toLowerCase();
  return ["walk", "run", "gym", "bike", "swim", "workout", "steps"].filter((word) => lowered.includes(word)).length * 120;
}
