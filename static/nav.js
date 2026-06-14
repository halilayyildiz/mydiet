(function () {
  document.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-menu-close]");
    if (!closeTarget) return;
    const menu = closeTarget.closest(".nav-menu");
    if (menu) {
      menu.open = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".nav-menu[open]").forEach((menu) => {
      menu.open = false;
    });
  });
})();
