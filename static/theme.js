(function () {
  const root = document.documentElement;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  const buttons = document.querySelectorAll("[data-theme-choice]");

  function paint() {
    buttons.forEach((button) => {
      button.classList.toggle("active", button.dataset.themeChoice === root.dataset.theme);
    });
    // The theme can differ from the phone's setting, so the status bar follows the page.
    const paper = getComputedStyle(root).getPropertyValue("--paper").trim();
    metas.forEach((meta) => {
      meta.media = "all";
      meta.content = paper;
    });
    if (statusBar) statusBar.content = root.dataset.theme === "dark" ? "black-translucent" : "default";
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const choice = button.dataset.themeChoice;
      if (choice === root.dataset.theme) return;
      try {
        localStorage.setItem("mydiet-theme", choice);
      } catch (error) {}
      root.dataset.theme = choice;
      // Charts read their colors once on load, so reload to redraw them in the new theme.
      if (document.querySelector(".svg-chart")) {
        window.location.reload();
        return;
      }
      paint();
    });
  });

  paint();
})();
