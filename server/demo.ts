// Read-only demo with made-up data, shared at /demo.
// It runs inside the same app (no extra process on the small server) but uses a database of its own, never the
// real one. The 90 days are rebuilt whenever the newest day is no longer today, so the demo always looks current:
// someone going from 101 kg to 92 kg, with a few overeating days along the way.
import type { Repo } from "./db.ts";
import { addDays, weekday } from "./dates.ts";
import { analysisFromItems, computeBmrCalories, type Meal } from "./nutrition.ts";

export const DEMO_USER = "demo";
const DEMO_DAYS = 90;
const START_KG = 101.0;
const END_KG = 92.0;

const PROFILE = {
  name: "Demo",
  username: DEMO_USER,
  age: 38,
  gender: "male",
  height_cm: 182,
  activity_level: "moderate",
  goal: "fat_loss",
  goal_weight_kg: 88.0,
  profile_complete: true,
};

type Dish = [name: string, calories: number, protein: number, carbs: number, fat: number];

// Turkish names: the demo's diary is in Turkish, like the owner's.
const MEALS: Record<Meal, Dish[]> = {
  morning: [
    ["2 haşlanmış yumurta, beyaz peynir, domates", 320, 22, 8, 22],
    ["Yulaf, süt ve muz", 380, 15, 62, 8],
    ["Menemen ve 1 dilim tam buğday ekmek", 420, 20, 30, 24],
    ["Yoğurt, granola ve çilek", 350, 16, 48, 10],
  ],
  lunch: [
    ["Tavuk salata", 480, 42, 18, 24],
    ["Mercimek çorbası ve bulgur pilavı", 560, 22, 88, 12],
    ["Izgara köfte ve salata", 620, 38, 20, 40],
    ["Ton balıklı sandviç", 520, 32, 50, 18],
    ["Etli kuru fasulye ve pilav", 690, 30, 92, 20],
  ],
  dinner: [
    ["Fırında somon ve sebze", 560, 40, 22, 32],
    ["Tavuk sote ve bulgur", 610, 45, 58, 18],
    ["Zeytinyağlı taze fasulye ve yoğurt", 420, 14, 36, 24],
    ["Izgara tavuk but ve közlenmiş sebze", 590, 48, 20, 34],
  ],
  snacks: [
    ["Elma", 90, 0, 23, 0],
    ["Bir avuç badem", 170, 6, 6, 15],
    ["Kefir", 120, 8, 12, 4],
    ["Türk kahvesi", 20, 0, 3, 1],
  ],
};

const CHEAT_MEALS: [...Dish, Meal][] = [
  ["Lahmacun (3 adet) ve ayran", 980, 40, 120, 34, "dinner"],
  ["İskender ve künefe", 1650, 60, 150, 85, "dinner"],
  ["Pizza (yarım büyük) ve kola", 1350, 48, 160, 52, "dinner"],
  ["Hamburger menü", 1250, 38, 130, 60, "lunch"],
  ["Baklava (4 dilim)", 680, 8, 80, 38, "snacks"],
];

const ACTIVITIES: [string, number][] = [
  ["", 0],
  ["8000 adım", 180],
  ["30 dk tempolu yürüyüş", 220],
  ["45 dk ağırlık antrenmanı", 280],
  ["40 dk koşu", 420],
  ["1 saat bisiklet", 480],
];

const LABELS: Record<Meal, string> = { morning: "Sabah", lunch: "Öğle", dinner: "Akşam", snacks: "Ara öğün" };

/** Small seeded random numbers (mulberry32), so a given start day always makes the same demo. */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const choice = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const sample = <T>(list: T[], k: number) => {
    const pool = [...list];
    return Array.from({ length: k }, () => pool.splice(Math.floor(next() * pool.length), 1)[0]);
  };
  return { next, int, choice, sample, uniform: (lo: number, hi: number) => lo + next() * (hi - lo) };
}

function dayMenu(rng: ReturnType<typeof seeded>, cheat: boolean) {
  let picks: [Meal, Dish][] = (["morning", "lunch", "dinner"] as Meal[]).map((meal) => [meal, rng.choice(MEALS[meal])]);
  picks.push(...rng.sample(MEALS.snacks, rng.int(1, 2)).map((dish): [Meal, Dish] => ["snacks", dish]));
  if (cheat) {
    const [name, calories, protein, carbs, fat, meal] = rng.choice(CHEAT_MEALS);
    picks = [...picks.filter(([m]) => m !== meal), [meal, [name, calories, protein, carbs, fat]]];
    picks.push(["snacks", ["Sütlaç ve kola", 520, 9, 90, 12]]);
  }
  const items = picks.map(([meal, [name, calories, protein_g, carbs_g, fat_g]]) => ({ name, meal, calories, protein_g, carbs_g, fat_g }));
  const diary = items.map((item) => `${LABELS[item.meal]}: ${item.name}`).join("\n");
  return { items, diary };
}

/** Rebuild the demo's 90 days unless they already end today. */
export function ensureDemoData(repo: Repo, today: string) {
  if (Object.keys(repo.getEntry(DEMO_USER, today)).length) return;
  const start = addDays(today, -(DEMO_DAYS - 1));
  const rng = seeded(Date.parse(start + "T00:00:00Z") / 86400_000);
  repo.transaction(() => {
    repo.clearUser(DEMO_USER);
    for (let offset = 0; offset < DEMO_DAYS; offset++) {
      const day = addDays(start, offset);
      const target = START_KG + ((END_KG - START_KG) * offset) / (DEMO_DAYS - 1);
      const weight = offset > 0 && offset < DEMO_DAYS - 1 ? Math.round((target + rng.uniform(-0.35, 0.35)) * 10) / 10 : target;
      const profile = { ...PROFILE, weight_kg: weight };
      const cheat = (weekday(day) === 4 || weekday(day) === 5) && rng.next() < 0.55;
      const { items, diary: menu } = dayMenu(rng, cheat);
      const [activityText, activity] = rng.choice(ACTIVITIES);
      const diary = activityText ? `${menu}\nAktivite: ${activityText}` : menu;
      const analysis = analysisFromItems(profile, { foodItems: items, activityCalories: activity, summary: "Örnek gün: demo verisi." });
      analysis.bmr_calories = computeBmrCalories(profile, { useStored: false });
      repo.saveEntry(DEMO_USER, day, { diary_text: diary, image_urls: [], analysis });
      if (offset % 3 === 0 || offset === DEMO_DAYS - 1) repo.saveWeight(DEMO_USER, day, weight);
    }
    const final = { ...PROFILE, weight_kg: END_KG };
    repo.saveProfile(DEMO_USER, { ...final, bmr_calories: computeBmrCalories(final, { useStored: false }) });
  });
}
