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

  function numberFromInput(input, fallback) {
    const value = Number.parseFloat((input?.value || "").replace(",", "."));
    return Number.isFinite(value) ? value : fallback;
  }

  function updateBmrPreview(form) {
    const preview = form.querySelector("[data-bmr-preview]");
    if (!preview) return;

    const weight = numberFromInput(form.elements.weight_kg, 80);
    const height = numberFromInput(form.elements.height_cm, 175);
    const age = numberFromInput(form.elements.age, 35);
    const gender = String(form.elements.gender?.value || "").toLowerCase();
    const activityLevel = String(form.elements.activity_level?.value || "low").toLowerCase();
    const multipliers = {
      low: 1.1,
      moderate: 1.25,
      high: 1.45,
    };
    const rawBmr = 10 * weight + 6.25 * height - 5 * age + (gender === "male" ? 5 : -161);
    const bmr = Math.round(rawBmr * (multipliers[activityLevel] || multipliers.low));
    preview.textContent = String(bmr);
  }

  document.querySelectorAll("[data-bmr-form]").forEach((form) => {
    updateBmrPreview(form);
    form.addEventListener("input", () => updateBmrPreview(form));
    form.addEventListener("change", () => updateBmrPreview(form));
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
