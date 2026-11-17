// Build info for the site footer (web/src/footer.js): version, last update, commit and latest changes,
// all read from git when the app is built (vite.config.ts puts it in the page as __BUILD_INFO__).
// Version: v<major>.<number of commits on main>, so it goes up by itself with every merge. Raise the
// major (MAJOR in vite.config.ts) by hand for a big release. The latest commit subjects are the
// changelog people see, so write them for readers of the site.
import { execFileSync } from "node:child_process";

export interface BuildInfo {
  version: string;
  date?: string;
  commit?: string;
  repo?: string;
  changes: { date: string; subject: string }[];
}

function git(args: string[], cwd: string) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function buildInfo(opts: { major: string; repo: string; cwd?: string; paths?: string[]; limit?: number }): BuildInfo {
  const { major, repo, cwd = process.cwd(), paths = [], limit = 15 } = opts;
  try {
    const count = git(["rev-list", "--count", "HEAD"], cwd);
    const [commit, date] = git(["log", "-1", "--format=%H%x09%cI"], cwd).split("\t");
    const log = git(["log", "--no-merges", `-n${limit * 2}`, "--format=%cI%x09%s", "HEAD", "--", ...paths], cwd);
    const changes = log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [d, ...rest] = line.split("\t");
        const subject = rest.join("\t").replace(/\s*\(#\d+\)\s*$/, "").trim();
        return { date: d, subject: subject.length > 140 ? subject.slice(0, 139) + "…" : subject };
      })
      .filter((c) => c.subject && !/^merge\b/i.test(c.subject))
      .slice(0, limit);
    return { version: `v${major}.${count}`, date, commit, repo, changes };
  } catch {
    return { version: `v${major}`, date: new Date().toISOString(), repo, changes: [] };
  }
}
