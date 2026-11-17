// Build info for the site footer (web/src/footer.js): version and date of the last update, read from
// git when the app is built (vite.config.ts puts it in the page as __BUILD_INFO__).
// Version: v<major>.<number of commits on main>, so it goes up by itself with every merge. Raise the
// major (MAJOR in vite.config.ts) by hand for a big release.
import { execFileSync } from "node:child_process";

export interface BuildInfo {
  version: string;
  date?: string;
}

function git(args: string[], cwd: string) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function buildInfo(opts: { major: string; cwd?: string }): BuildInfo {
  const { major, cwd = process.cwd() } = opts;
  try {
    const count = git(["rev-list", "--count", "HEAD"], cwd);
    const date = git(["log", "-1", "--format=%cI"], cwd);
    return { version: `v${major}.${count}`, date };
  } catch {
    return { version: `v${major}`, date: new Date().toISOString() };
  }
}
