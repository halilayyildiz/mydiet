// Calls to the server's JSON API.

export type Session = { authenticated: boolean; username: string | null; demo: boolean; lang: string; needsProfile: boolean; today: string };

export type TrendRow = { date: string; has_data: boolean; food?: number; basal?: number; burned?: number; activity?: number; deficit?: number };
export type WeightRow = { date: string; has_data: boolean; weight?: number };
export type CalendarDay = { date: string; day: number; deficit: number; logged: boolean; tone: string };
export type CalendarData = { month: string; previous: string; next: string; blanks: number; days: CalendarDay[] };
export type Averages = { food: number; basal: number; burned: number; activity: number; deficit: number };
export type Balance = Averages & { weekly_kg: number; food_pct: number; burned_pct: number; basal_pct: number; activity_pct: number };

export type DashboardData = {
  range: string;
  rangeDays: number;
  rangeOptions: Record<string, number>;
  today: string;
  rangeLabel: string;
  recordedDays: number;
  trends: TrendRow[];
  weights: WeightRow[];
  averages: Averages;
  balance: Balance;
  calendar: CalendarData;
};

export type FoodItem = { name: string; meal: string; calories: number; protein_g: number; carbs_g: number; fat_g: number };
export type Analysis = {
  food_calories: number; bmr_calories?: number; burned_calories: number; activity_calories: number; calorie_deficit: number;
  protein_g?: number; carbs_g?: number; fat_g?: number; confidence: string; summary: string; assumptions?: string[]; food_items?: FoodItem[];
};
export type EntryData = {
  date: string;
  today: string;
  entry: { diary_text?: string; analysis?: Analysis; image_urls?: string[] };
  foodGroups: { key: string; calories: number; items: FoodItem[] }[];
};
export type WeightData = { today: string; currentWeight: number | null; logs: { date: string; weight_kg: number }[] };
export type Profile = Record<string, any>;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  // Signed out (or the session expired): let the server send this visitor to the login page or the demo.
  if (r.status === 401 && data.error === "unauthorized") {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!r.ok) throw new ApiError(r.status, data.error ?? "server_error");
  return data as T;
}

export const api = {
  session: () => req<Session>("GET", "/api/session"),
  login: (username: string, password: string) => req<{ ok: true; needsProfile: boolean }>("POST", "/api/login", { username, password }),
  register: (username: string, password: string) => req<{ ok: true }>("POST", "/api/register", { username, password }),
  logout: () => req("POST", "/api/logout"),
  setLanguage: (lang: string) => req<{ lang: string }>("POST", "/api/language", { lang }),
  dashboard: (range: string, month?: string) =>
    req<DashboardData>("GET", `/api/dashboard?range=${encodeURIComponent(range)}${month ? `&month=${encodeURIComponent(month)}` : ""}`),
  calendar: (month: string) => req<CalendarData>("GET", `/api/calendar?month=${encodeURIComponent(month)}`),
  entry: (date: string) => req<EntryData>("GET", `/api/entry?date=${encodeURIComponent(date)}`),
  saveEntry: (date: string, diary_text: string) => req<EntryData>("POST", "/api/entry", { date, diary_text }),
  weight: () => req<WeightData>("GET", "/api/weight"),
  saveWeight: (date: string, weight_kg: string) => req("POST", "/api/weight", { date, weight_kg }),
  profile: () => req<{ profile: Profile; today: string }>("GET", "/api/profile"),
  saveProfile: (p: Record<string, string>) => req<{ ok: true; complete: boolean }>("POST", "/api/profile", p),
};
