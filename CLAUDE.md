# CLAUDE.md

## Version and footer

Every page has the shared footer (`web/src/footer.js`, the same file in all of Halil's sites and apps): a link to halilayyildiz.com, © and email, then the version and the date of the last update. Halil asked to keep it this minimal: no GitHub/LinkedIn links, no changelog, no commit link.

- **Every update raises the version.** It is `v<major>.<commits on main>`, computed at build time by `build-info.ts` from git, so each merge to main bumps it by itself. Don't hard-code a version anywhere.
- For a big release, raise the major by hand (`MAJOR` in `vite.config.ts`).
- Keep `web/src/footer.js` identical across repos: when you change it, change it in halilayyildiz.com (`site/footer.js`, `about/footer.js`) and every app.
