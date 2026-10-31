// Claude's estimate of a day from the web form's free-text notes.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import type { Config } from "./config.ts";
import { fallbackAnalysis, normalizeAnalysis, type Analysis, type Profile } from "./nutrition.ts";

const num = { type: "number" };

const FOOD_ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    meal: { type: "string", enum: ["morning", "lunch", "dinner", "snacks"] },
    calories: num,
    protein_g: num,
    carbs_g: num,
    fat_g: num,
  },
  required: ["name", "meal", "calories", "protein_g", "carbs_g", "fat_g"],
  additionalProperties: false,
};

const DAY_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    food_calories: num,
    food_items: { type: "array", items: FOOD_ITEM_SCHEMA },
    bmr_calories: num,
    activity_calories: num,
    burned_calories: num,
    calorie_deficit: num,
    protein_g: num,
    carbs_g: num,
    fat_g: num,
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
  },
  required: [
    "food_calories", "food_items", "bmr_calories", "activity_calories", "burned_calories", "calorie_deficit",
    "protein_g", "carbs_g", "fat_g", "confidence", "summary", "assumptions",
  ],
  additionalProperties: false,
};

/** The prompt template with its {placeholders} filled in ({{ and }} are literal braces, as in Python's str.format). */
export function analysisPrompt(config: Config, diaryText: string, profile: Profile, entryDate: string, lang: string): string {
  const template = readFileSync(config.analysisPromptPath, "utf8");
  const values: Record<string, string> = {
    entry_date: entryDate,
    language: lang,
    output_language: lang === "tr" ? "Turkish" : "English",
    profile_json: JSON.stringify(profile),
    diary_text: diaryText,
  };
  return template
    .replace(/\{\{|\}\}|\{(\w+)\}/g, (match, key: string | undefined) => (match === "{{" ? "{" : match === "}}" ? "}" : values[key!] ?? match))
    .trim();
}

export type Analyzer = (args: { diaryText: string; profile: Profile; entryDate: string; lang: string }) => Promise<Record<string, any>>;

/** Calls Claude with structured output, so the reply is always the analysis JSON. */
export function claudeAnalyzer(config: Config): Analyzer {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  return async ({ diaryText, profile, entryDate, lang }) => {
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: DAY_ANALYSIS_SCHEMA } },
      messages: [{ role: "user", content: analysisPrompt(config, diaryText, profile, entryDate, lang) }],
    });
    if (response.stop_reason === "refusal") throw new Error("Claude declined to analyze this day.");
    const text = response.content.find((block) => block.type === "text");
    if (!text) throw new Error(`Claude returned no analysis (stop reason: ${response.stop_reason}).`);
    return JSON.parse(text.text);
  };
}

/** Claude's analysis of a day, or a rough estimate when Claude is unavailable or fails. */
export async function analyzeEntry(
  config: Config,
  analyzer: Analyzer | null,
  args: { diaryText: string; profile: Profile; entryDate: string; lang: string },
): Promise<Analysis> {
  const { diaryText, profile, lang } = args;
  if (!analyzer || !diaryText) {
    const reason =
      lang === "tr"
        ? "Günlük metni ve görsellerden hesaplamak için ANTHROPIC_API_KEY ayarla."
        : "Set ANTHROPIC_API_KEY to calculate from diary text and images.";
    return fallbackAnalysis(diaryText, profile, reason, lang);
  }
  try {
    return normalizeAnalysis(await analyzer(args));
  } catch (e) {
    const message = (e as Error).message;
    const summary = lang === "tr" ? `Claude analizi başarısız oldu: ${message}` : `Claude analysis failed: ${message}`;
    return { ...fallbackAnalysis(diaryText, profile, summary, lang), summary };
  }
}
