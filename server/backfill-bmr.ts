// Recompute basal burn, total burn and deficit of every stored day from the current profile.
//   npm run backfill-bmr -- [--user halil] [--apply]      (without --apply nothing is written)
import { loadConfig } from "./config.ts";
import { Repo } from "./db.ts";
import { computeBmrCalories, toInt } from "./nutrition.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const config = loadConfig();
const userAt = args.indexOf("--user");
const userId = userAt >= 0 ? args[userAt + 1] : config.singleUserId;
const repo = new Repo(config.dbPath);

const bmr = computeBmrCalories(repo.getProfile(userId), { useStored: false });
if (apply) repo.saveProfile(userId, { bmr_calories: bmr });
const lines: string[] = [];
for (const entry of repo.listAllEntries(userId)) {
  const date = String(entry.date || entry.id || "");
  const analysis = entry.analysis;
  if (!date || !analysis || typeof analysis !== "object") continue;
  const burned = bmr + toInt(analysis.activity_calories);
  const deficit = burned - toInt(analysis.food_calories);
  const before = [toInt(analysis.bmr_calories), toInt(analysis.burned_calories), toInt(analysis.calorie_deficit)];
  if (before[0] === bmr && before[1] === burned && before[2] === deficit) continue;
  lines.push(`${date}: bmr ${before[0]}->${bmr}, burned ${before[1]}->${burned}, deficit ${before[2]}->${deficit}`);
  if (apply) repo.updateEntryAnalysis(userId, date, { ...analysis, bmr_calories: bmr, burned_calories: burned, calorie_deficit: deficit });
}
console.log(`${apply ? "APPLY" : "DRY-RUN"}: ${lines.length} entries need BMR backfill for user ${userId}.`);
for (const line of lines) console.log(line);
if (!apply) console.log("No writes performed. Re-run with --apply to update the database.");
