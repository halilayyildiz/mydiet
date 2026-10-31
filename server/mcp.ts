// A small MCP server (streamable HTTP, JSON responses) so a Claude chat can save the days it already worked out
// (foods, calories, activity) here.
//
// claude.ai connects to https://<host>/mcp/<MCP_TOKEN>; the secret path is the only credential.
// An iPhone Shortcut posts the scale's Apple Health weight to /api/<MCP_TOKEN>/weight with the same secret.
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { Repo } from "./db.ts";
import { isoDate, localDate } from "./dates.ts";
import { analysisFromItems, computeBmrCalories } from "./nutrition.ts";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "mydiet", version: "0.2.0" };

const DATE = {
  type: "string",
  description: "Day as YYYY-MM-DD. Defaults to today in the user's timezone (Europe/Amsterdam).",
};

const FOOD_ITEM = {
  type: "object",
  properties: {
    name: { type: "string", description: 'Short name in Turkish, e.g. "2 haşlanmış yumurta".' },
    meal: { type: "string", enum: ["morning", "lunch", "dinner", "snacks"] },
    calories: { type: "number" },
    protein_g: { type: "number" },
    carbs_g: { type: "number" },
    fat_g: { type: "number" },
  },
  required: ["name", "meal", "calories"],
};

export const TOOLS = [
  {
    name: "save_day",
    description:
      "Save a day in MyDiet with the calories you already worked out in this chat. Send the " +
      "WHOLE day every time (every food and drink so far, not just the new ones): it replaces " +
      "what is stored for that date, so calling it again after each meal is safe. Totals and " +
      "the deficit are computed from the items. Call get_day first if the day may hold items " +
      "you don't know about.",
    inputSchema: {
      type: "object",
      properties: {
        date: DATE,
        diary_text: {
          type: "string",
          description: "What the user wrote about the day, in their words (shown as the day's notes).",
        },
        food_items: { type: "array", items: FOOD_ITEM },
        activity_calories: {
          type: "number",
          description: "Calories burned by exercise and activity beyond normal daily life.",
        },
        burned_calories: {
          type: "number",
          description:
            "Total calories burned that day (BMR + activity). Omit to let MyDiet estimate it " +
            "from the profile plus activity_calories.",
        },
        summary: { type: "string", description: "One or two sentences on the day, in Turkish." },
      },
      required: ["diary_text", "food_items"],
    },
  },
  {
    name: "get_day",
    description: "Read a day's diary text, its calorie/macro analysis and the weight logged that day from MyDiet.",
    inputSchema: { type: "object", properties: { date: DATE } },
  },
  {
    name: "list_days",
    description: "Calories eaten, burned and deficit for each logged day in a date range.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "log_weight",
    description: "Record the user's body weight in kg for a day.",
    inputSchema: {
      type: "object",
      properties: { weight_kg: { type: "number" }, date: DATE },
      required: ["weight_kg"],
    },
  },
  {
    name: "list_weights",
    description:
      "Body weight logged for each day in a date range (from the scale's daily iPhone Shortcut or log_weight), " +
      "oldest first, plus the change over the range.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
      },
      required: ["start_date"],
    },
  },
];

class ToolError extends Error {}

/** Python's repr() of a value, for error messages the chat shows (e.g. 'abc' or None). */
function repr(value: unknown): string {
  if (value === undefined || value === null) return "None";
  if (typeof value === "string") return `'${value}'`;
  if (typeof value === "boolean") return value ? "True" : "False";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const tokenMatches = (config: Config, token: string) => {
  const a = Buffer.from(token);
  const b = Buffer.from(config.mcpToken);
  return config.mcpToken !== "" && a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Shortcuts may send 82.4, "82,4" (Turkish locale), "82.4 kg", "181 lb", or a whole sample as text (dates and
 * all); pick the number that looks like a body weight and convert it to kg.
 */
export function shortcutWeight(value: unknown): number {
  let candidates: [number, string][];
  if (typeof value === "number") {
    candidates = [[value, ""]];
  } else {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
    candidates = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|lbs?|g)?(?![a-z])/gi)].map((m) => [
      Number(m[1].replace(",", ".")),
      (m[2] ?? "").toLowerCase(),
    ]);
  }
  const toKg: Record<string, number> = { "": 1, kg: 1, lb: 0.45359237, lbs: 0.45359237, g: 0.001 };
  const weights = candidates.map(([n, unit]) => Math.round(n * toKg[unit] * 100) / 100);
  const tagged = weights.filter((_, i) => candidates[i][1]);
  for (const weight of [...tagged, ...weights]) if (weight >= 20 && weight <= 400) return weight;
  throw new ToolError(`weight_kg must be a body weight between 20 and 400 kg; got ${repr(value)}.`);
}

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function registerMcp(app: FastifyInstance, repo: Repo, config: Config) {
  const userId = config.singleUserId;

  const day = (value: unknown): string => {
    if (!value) return localDate(config.timezone);
    const date = isoDate(value);
    if (!date) throw new ToolError(`Invalid date ${repr(value)}; use YYYY-MM-DD.`);
    return date;
  };

  const recordWeight = (date: string, weightKg: number) => {
    repo.saveWeight(userId, date, weightKg);
    const profile = { ...repo.getProfile(userId), weight_kg: weightKg };
    repo.saveProfile(userId, { bmr_calories: computeBmrCalories(profile, { useStored: false }) });
  };

  const handlers: Record<string, (args: Record<string, any>) => Record<string, any>> = {
    save_day(args) {
      if (!Array.isArray(args.food_items)) throw new ToolError("food_items must be a list.");
      const date = day(args.date);
      const entry = repo.getEntry(userId, date);
      const analysis = analysisFromItems(repo.getProfile(userId), {
        foodItems: args.food_items,
        activityCalories: args.activity_calories,
        burnedCalories: args.burned_calories,
        summary: String(args.summary || ""),
      });
      const diaryText = String(args.diary_text || "").trim();
      repo.saveEntry(userId, date, { diary_text: diaryText, image_urls: entry.image_urls || [], analysis });
      return {
        date,
        saved_items: analysis.food_items.length,
        food_calories: analysis.food_calories,
        burned_calories: analysis.burned_calories,
        calorie_deficit: analysis.calorie_deficit,
      };
    },
    get_day(args) {
      const date = day(args.date);
      const entry = repo.getEntry(userId, date);
      const weights = repo.listWeightLogs(userId, date, date);
      const weight = weights.length ? { weight_kg: weights.at(-1)!.weight_kg } : {};
      if (!Object.keys(entry).length) return { date, logged: false, ...weight };
      return { date, diary_text: entry.diary_text ?? "", analysis: entry.analysis ?? null, ...weight };
    },
    list_days(args) {
      const start = day(args.start_date);
      const end = day(args.end_date);
      return {
        days: repo.listEntries(userId, start, end).map((entry) => {
          const analysis = entry.analysis || {};
          return {
            date: entry.date ?? null,
            food_calories: analysis.food_calories ?? null,
            burned_calories: analysis.burned_calories ?? null,
            calorie_deficit: analysis.calorie_deficit ?? null,
          };
        }),
      };
    },
    log_weight(args) {
      const weightKg = typeof args.weight_kg === "boolean" ? Number(args.weight_kg) : Number(args.weight_kg ?? NaN);
      if (args.weight_kg === null || args.weight_kg === "" || Array.isArray(args.weight_kg) || !Number.isFinite(weightKg)) {
        throw new ToolError("weight_kg must be a number.");
      }
      const date = day(args.date);
      recordWeight(date, weightKg);
      return { date, weight_kg: weightKg };
    },
    list_weights(args) {
      const start = day(args.start_date);
      const end = day(args.end_date);
      const weights = repo.listWeightLogs(userId, start, end).map((log) => ({ date: log.date ?? null, weight_kg: log.weight_kg ?? null }));
      const result: Record<string, any> = { weights };
      if (weights.length > 1) result.change_kg = Math.round((weights.at(-1)!.weight_kg - weights[0].weight_kg) * 100) / 100;
      return result;
    },
  };

  function callTool(params: Record<string, any>) {
    const handler = Object.hasOwn(handlers, params.name ?? "") ? handlers[params.name] : undefined;
    if (!handler) throw new RangeError(`Unknown tool ${repr(params.name)}`);
    try {
      const result = handler(params.arguments || {});
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      if (e instanceof ToolError) return { content: [{ type: "text", text: e.message }], isError: true };
      throw e;
    }
  }

  function handle(message: unknown): Record<string, any> | null {
    if (!message || typeof message !== "object" || Array.isArray(message)) return null;
    const msg = message as Record<string, any>;
    if (!("id" in msg)) return null; // notifications need no answer
    let result: Record<string, any>;
    try {
      switch (msg.method) {
        case "initialize":
          result = {
            protocolVersion: msg.params?.protocolVersion || PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          };
          break;
        case "ping":
          result = {};
          break;
        case "tools/list":
          result = { tools: TOOLS };
          break;
        case "tools/call":
          result = callTool(msg.params || {});
          break;
        default:
          return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (e) {
      if (e instanceof RangeError) return rpcError(msg.id, -32602, e.message);
      throw e;
    }
    return { jsonrpc: "2.0", id: msg.id, result };
  }

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/:token",
    handler: async (req, reply) => {
      if (!tokenMatches(config, (req.params as { token: string }).token)) return reply.status(404).send({ error: "Not found" });
      if (req.method !== "POST") return reply.status(405).header("Allow", "POST").send();
      const payload = req.body;
      if (Array.isArray(payload)) {
        const replies = payload.map(handle).filter(Boolean);
        return replies.length ? replies : reply.status(202).send();
      }
      if (!payload || typeof payload !== "object") return reply.status(400).send(rpcError(null, -32700, "Parse error"));
      const answer = handle(payload);
      return answer ?? reply.status(202).send();
    },
  });

  app.post("/api/:token/weight", async (req, reply) => {
    if (!tokenMatches(config, (req.params as { token: string }).token)) return reply.status(404).send({ error: "Not found" });
    const payload = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, any>;
    try {
      const weightKg = shortcutWeight(payload.weight_kg);
      // Shortcuts' ISO 8601 date is local time with an offset, so its first 10 characters are the day.
      const date = day(String(payload.date || "").slice(0, 10));
      recordWeight(date, weightKg);
      return { date, weight_kg: weightKg };
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      req.log.warn({ payload }, `weight_api rejected: ${e.message}`);
      return reply.status(400).send({ error: e.message });
    }
  });
}
