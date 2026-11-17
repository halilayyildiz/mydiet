# CLAUDE.md

## Version, footer and changelog

Every page has the shared footer (`web/src/footer.js`, the same file in all of Halil's sites and apps): version, date of the last update, commit, a link to halilayyildiz.com, © and contact links. Clicking the version opens the latest changes.

- **Every update raises the version.** It is `v<major>.<commits on main>`, computed at build time by `build-info.ts` from git, so each merge to main bumps it by itself. Don't hard-code a version anywhere.
- For a big release, raise the major by hand (`MAJOR` in `vite.config.ts`).
- The changelog is the latest commit subjects (PR titles when squash-merged, with the `(#12)` removed). Write them as a short, readable sentence of what changed for the user; they are shown on the live site, so keep secrets and internal details out.
- Keep `web/src/footer.js` identical across repos: when you change it, change it in halilayyildiz.com (`site/footer.js`, `about/footer.js`) and every app.
