(function () {
  const parser = new DOMParser();

  function calendarSection() {
    return document.querySelector(".calendar-section");
  }

  function setLoading(isLoading) {
    const section = calendarSection();
    if (!section) return;
    section.classList.toggle("is-loading", isLoading);
    section.setAttribute("aria-busy", String(isLoading));
  }

  async function loadCalendar(url, pushHistory) {
    const section = calendarSection();
    if (!section) return;
    setLoading(true);
    try {
      const response = await fetch(url, {
        headers: { "X-Requested-With": "fetch" },
      });
      if (!response.ok) throw new Error(`Calendar request failed: ${response.status}`);
      const html = await response.text();
      const nextDocument = parser.parseFromString(html, "text/html");
      const nextSection = nextDocument.querySelector(".calendar-section");
      if (!nextSection) throw new Error("Calendar section missing from response.");
      section.replaceWith(nextSection);
      if (pushHistory) {
        window.history.pushState({}, "", url);
      }
    } catch (error) {
      window.location.href = url;
    } finally {
      setLoading(false);
    }
  }

  function urlFromMonthInput(input) {
    const form = input.closest("[data-calendar-form]");
    const url = new URL(form.getAttribute("action") || window.location.pathname, window.location.origin);
    const current = new URL(window.location.href);
    const range = form.querySelector('input[name="range"]')?.value || current.searchParams.get("range");
    if (range) url.searchParams.set("range", range);
    url.searchParams.set("month", input.value);
    return url.toString();
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-calendar-link]");
    if (!link) return;
    event.preventDefault();
    loadCalendar(link.href, true);
  });

  document.addEventListener("change", (event) => {
    const input = event.target.closest("[data-calendar-month]");
    if (!input || !input.value) return;
    loadCalendar(urlFromMonthInput(input), true);
  });

  document.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-calendar-form]")) return;
    event.preventDefault();
  });

  window.addEventListener("popstate", () => {
    loadCalendar(window.location.href, false);
  });
})();
