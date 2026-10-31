// Light / dark, remembered on this device (index.html applies it before the page draws).
export type Theme = "light" | "dark";
const KEY = "mydiet-theme";

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** The phone's top bar follows the page, since the theme can differ from the phone's setting. */
export function paintTheme() {
  const root = document.documentElement;
  const paper = getComputedStyle(root).getPropertyValue("--paper").trim();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.media = "all";
    if (paper) meta.content = paper;
  });
  const statusBar = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusBar) statusBar.content = currentTheme() === "dark" ? "black-translucent" : "default";
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  document.documentElement.dataset.theme = theme;
  paintTheme();
  // Charts read their colors from CSS variables and redraw on this.
  dispatchEvent(new Event("mydiet-theme"));
}
