// Site footer shared by halilayyildiz.com, the CV and every app (the same file is copied into each repo).
// Shows a link back to the homepage, © and email, then the version and the date of the last update
// (filled in at build time, see build-info). Follows the page's language (<html lang>) and colors.

const MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';

const CSS = `
.ha-footer { box-sizing: border-box; width: 100%; max-width: 72rem; margin: 0 auto; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); font: 12px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; }
.ha-footer .ha-in { opacity: .62; border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); padding-top: 14px; }
.ha-footer a { color: inherit; text-decoration: none; }
.ha-footer a:hover { text-decoration: underline; text-underline-offset: 2px; }
.ha-footer .ha-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px 10px; }
.ha-footer .ha-row + .ha-row { margin-top: 2px; }
.ha-footer .ha-sep { opacity: .5; }
.ha-footer .ha-mail { display: inline-grid; place-items: center; width: 22px; height: 22px; }
.ha-footer .ha-mail:hover { opacity: .7; }
.ha-footer .ha-mail svg { width: 15px; height: 15px; }
.ha-footer .ha-ver { font-variant-numeric: tabular-nums; }
@media print { .ha-footer { display: none; } }
`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function day(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const tr = (document.documentElement.lang || "").toLowerCase().startsWith("tr");
  return d.toLocaleDateString(tr ? "tr-TR" : "en-US", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Adds the footer at the end of <body> (or options.parent).
 * info: the build info object ({ version, date }), or the URL of a JSON file with it (static pages).
 * Missing info only hides the version line. options.home: false leaves out the homepage link (for the
 * homepage itself).
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
  const sep = '<span class="ha-sep" aria-hidden="true">·</span>';

  function render() {
    const parts = [];
    if (opts.home !== false) parts.push('<a href="https://halilayyildiz.com">halilayyildiz.com</a>');
    parts.push("<span>© " + new Date().getFullYear() + " Halil Ayyıldız</span>");
    parts.push('<a class="ha-mail" href="mailto:halil.ayyildiz@gmail.com" aria-label="Email" title="Email">' + MAIL + "</a>");
    let html = '<div class="ha-in"><div class="ha-row">' + parts.join(sep) + "</div>";
    if (build && build.version) {
      const meta = ['<span class="ha-ver">' + esc(build.version) + "</span>"];
      if (build.date) meta.push('<time datetime="' + esc(build.date) + '">' + day(build.date) + "</time>");
      html += '<div class="ha-row">' + meta.join(sep) + "</div>";
    }
    el.innerHTML = html + "</div>";
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
