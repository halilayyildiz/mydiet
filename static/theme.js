(function () {
  const root = document.documentElement;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const buttons = document.querySelectorAll("[data-theme-choice]");

  function current() {
    return root.dataset.theme || "auto";
  }

  function paint() {
    const choice = current();
    buttons.forEach((button) => {
      button.classList.toggle("active", button.dataset.themeChoice === choice);
    });
    // A picked theme overrides the phone's setting, so the status bar must follow it too.
    const paper = getComputedStyle(root).getPropertyValue("--paper").trim();
    metas.forEach((meta) => {
      if (!meta.dataset.media) {
        meta.dataset.media = meta.media;
        meta.dataset.color = meta.content;
      }
      meta.media = choice === "auto" ? meta.dataset.media : "all";
      meta.content = choice === "auto" ? meta.dataset.color : paper;
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const choice = button.dataset.themeChoice;
      if (choice === current()) return;
      try {
        if (choice === "auto") localStorage.removeItem("mydiet-theme");
        else localStorage.setItem("mydiet-theme", choice);
      } catch (error) {}
      // Charts read their colors once on load, so reload to redraw them in the new theme.
      if (choice === "auto") delete root.dataset.theme;
      else root.dataset.theme = choice;
      if (document.querySelector(".svg-chart")) {
        window.location.reload();
        return;
      }
      paint();
    });
  });

  paint();
})();
