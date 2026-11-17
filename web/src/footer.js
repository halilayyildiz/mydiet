// Site footer shared by halilayyildiz.com, the CV and every app (the same file is copied into each repo).
// Shows the version, the date of the last update and its commit (all filled in at build time, see
// build-info), a link back to the homepage, © and contact links. Clicking the version opens the
// latest changes. Follows the page's language (<html lang>) and its colors (currentColor).

const T = {
  tr: { changes: "Son değişiklikler", version: "Sürüm", commit: "Commit", home: "Ana sayfa", close: "Kapat" },
  en: { changes: "Latest changes", version: "Version", commit: "Commit", home: "Home", close: "Close" },
};

const ICONS = {
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.5h4V21H3V9.5Zm6.5 0h3.8v1.6h.06c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.77 2.65 4.77 6.1V21h-4v-5.1c0-1.22-.02-2.78-1.7-2.78-1.7 0-1.96 1.33-1.96 2.7V21h-4V9.5Z"/></svg>',
};

const CSS = `
.ha-footer { box-sizing: border-box; width: 100%; max-width: 72rem; margin: 0 auto; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); font: 12px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; }
.ha-footer, .ha-footer * { box-sizing: border-box; }
.ha-footer .ha-in { opacity: .62; border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); padding-top: 14px; }
.ha-footer a, .ha-footer button { color: inherit; text-decoration: none; font: inherit; }
.ha-footer a:hover, .ha-footer button:hover { text-decoration: underline; text-underline-offset: 2px; }
.ha-footer .ha-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px 10px; }
.ha-footer .ha-row + .ha-row { margin-top: 4px; }
.ha-footer .ha-sep { opacity: .5; }
.ha-footer .ha-icons { display: inline-flex; gap: 10px; align-items: center; margin-left: 6px; }
.ha-footer .ha-icons a { display: inline-grid; place-items: center; width: 22px; height: 22px; }
.ha-footer .ha-icons a:hover { text-decoration: none; opacity: .7; }
.ha-footer .ha-icons svg { width: 15px; height: 15px; }
.ha-footer .ha-ver { background: none; border: 0; padding: 0; cursor: pointer; font-variant-numeric: tabular-nums; }
.ha-footer .ha-ver[aria-expanded="true"] { text-decoration: underline; text-underline-offset: 2px; }
.ha-footer code { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.ha-footer .ha-changes { max-width: 560px; margin: 12px auto 0; text-align: left; }
.ha-footer .ha-changes h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 6px; }
.ha-footer .ha-changes ol { list-style: none; margin: 0; padding: 0; }
.ha-footer .ha-changes li { display: grid; grid-template-columns: 7.5em 1fr; gap: 8px; padding: 3px 0; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
.ha-footer .ha-changes li:first-child { border-top: 0; }
.ha-footer .ha-changes time { white-space: nowrap; font-variant-numeric: tabular-nums; }
@media print { .ha-footer { display: none; } }
`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function lang() {
  return (document.documentElement.lang || "").toLowerCase().startsWith("tr") ? "tr" : "en";
}

function day(iso, l) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(l === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Adds the footer at the end of <body> (or options.parent).
 * info: the build info object, or the URL of a JSON file with it (static pages). Missing info only hides
 * the version line. options.home: false leaves out the homepage link (for the homepage itself);
 * options.parent: the element to add it to, when not <body>.
 */
export function mountFooter(info, options) {
  const opts = options || {};
  if (!document.getElementById("ha-footer-css")) {
    const style = document.createElement("style");
    style.id = "ha-footer-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const el = document.createElement("footer");
  el.className = "ha-footer";
  (opts.parent || document.body).appendChild(el);
  let build = typeof info === "object" && info ? info : null;
  let open = false;

  function render() {
    const l = lang();
    const t = T[l];
    const year = new Date().getFullYear();
    const parts = [];
    if (opts.home !== false) parts.push('<a href="https://halilayyildiz.com" title="' + t.home + '">halilayyildiz.com</a>');
    parts.push("<span>© " + year + " Halil Ayyıldız</span>");
    parts.push(
      '<span class="ha-icons">' +
        '<a href="mailto:halil.ayyildiz@gmail.com" aria-label="Email" title="Email">' + ICONS.mail + "</a>" +
        '<a href="https://github.com/halilayyildiz" aria-label="GitHub" title="GitHub" rel="noopener">' + ICONS.github + "</a>" +
        '<a href="https://www.linkedin.com/in/halilayyildiz/" aria-label="LinkedIn" title="LinkedIn" rel="noopener">' + ICONS.linkedin + "</a>" +
      "</span>",
    );
    const icons = parts.pop();
    let html = '<div class="ha-in"><div class="ha-row">' + parts.join('<span class="ha-sep" aria-hidden="true">·</span>') + icons + "</div>";
    if (build && build.version) {
      const changes = Array.isArray(build.changes) ? build.changes : [];
      const meta = [];
      meta.push(
        changes.length
          ? '<button type="button" class="ha-ver" aria-expanded="' + open + '" aria-controls="ha-changes" title="' + t.changes + '">' + esc(build.version) + "</button>"
          : '<span class="ha-ver" title="' + t.version + '">' + esc(build.version) + "</span>",
      );
      if (build.date) meta.push('<time datetime="' + esc(build.date) + '">' + day(build.date, l) + "</time>");
      if (build.commit) {
        const short = esc(String(build.commit).slice(0, 7));
        meta.push(
          build.repo
            ? '<a href="https://github.com/' + esc(build.repo) + "/commit/" + esc(build.commit) + '" title="' + t.commit + '" rel="noopener"><code>' + short + "</code></a>"
            : "<code>" + short + "</code>",
        );
      }
      html += '<div class="ha-row">' + meta.join('<span class="ha-sep" aria-hidden="true">·</span>') + "</div>";
      if (changes.length) {
        html += '<div class="ha-changes" id="ha-changes"' + (open ? "" : " hidden") + "><h2>" + t.changes + "</h2><ol>" +
          changes.map((c) => '<li><time datetime="' + esc(c.date) + '">' + day(c.date, l) + "</time><span>" + esc(c.subject) + "</span></li>").join("") +
          "</ol></div>";
      }
    }
    el.innerHTML = html + "</div>";
    const btn = el.querySelector("button.ha-ver");
    if (btn) btn.addEventListener("click", () => {
      open = !open;
      render();
      if (open) { const box = el.querySelector(".ha-changes"); if (box) box.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    });
  }

  render();
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  if (typeof info === "string") {
    fetch(info, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { build = j; render(); } })
      .catch(() => {});
  }
  return el;
}
