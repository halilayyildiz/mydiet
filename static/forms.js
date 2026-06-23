(function () {
  const text = {
    saving: "Saving...",
    ...(window.MYDIET_FORM_TEXT || {}),
  };

  function setLoading(form) {
    if (form.dataset.submitting === "true") {
      return false;
    }
    form.dataset.submitting = "true";
    form.setAttribute("aria-busy", "true");
    form.classList.add("is-submitting");

    const status = form.querySelector("[data-loading-status]");
    const statusText = form.querySelector("[data-loading-status-text]");
    if (status && statusText) {
      statusText.textContent = form.dataset.loadingMessage || text.saving;
      status.hidden = false;
    }

    const submitButtons = form.querySelectorAll('button[type="submit"]');
    submitButtons.forEach((button) => {
      button.dataset.defaultLabel = button.textContent.trim();
      button.textContent = button.dataset.loadingLabel || text.saving;
      button.disabled = true;
    });

    return true;
  }

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-loading-form]")) {
      return;
    }
    if (!setLoading(form)) {
      event.preventDefault();
    }
  });

  window.addEventListener("pageshow", () => {
    document.querySelectorAll("[data-loading-form]").forEach((form) => {
      form.dataset.submitting = "false";
      form.removeAttribute("aria-busy");
      form.classList.remove("is-submitting");

      const status = form.querySelector("[data-loading-status]");
      if (status) {
        status.hidden = true;
      }

      form.querySelectorAll('button[type="submit"]').forEach((button) => {
        button.disabled = false;
        if (button.dataset.defaultLabel) {
          button.textContent = button.dataset.defaultLabel;
        }
      });
    });
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-weight-step]");
    if (!button) return;
    const stepper = button.closest("[data-weight-stepper]");
    const input = stepper?.querySelector('input[name="weight_kg"]');
    if (!input) return;
    const current = Number.parseFloat(input.value.replace(",", "."));
    const step = Number.parseFloat(button.dataset.weightStep || "0");
    const next = (Number.isFinite(current) ? current : 0) + step;
    input.value = Math.max(next, 0).toFixed(1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  document.addEventListener("click", (event) => {
    document.querySelectorAll(".header-menu[open]").forEach((menu) => {
      if (!menu.contains(event.target)) {
        menu.open = false;
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".header-menu[open]").forEach((menu) => {
      menu.open = false;
    });
  });
})();
