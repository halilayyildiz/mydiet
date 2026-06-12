(function () {
  const css = getComputedStyle(document.documentElement);
  const colors = {
    muted: css.getPropertyValue("--muted").trim(),
    line: css.getPropertyValue("--line").trim(),
    food: css.getPropertyValue("--coral").trim(),
    burned: css.getPropertyValue("--green").trim(),
    activity: css.getPropertyValue("--blue").trim(),
  };

  function formatValue(value) {
    return Math.round(Number(value || 0)).toLocaleString();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function ensureTooltip(container) {
    let tooltip = container.querySelector(".chart-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "chart-tooltip";
      tooltip.hidden = true;
      container.appendChild(tooltip);
    }
    return tooltip;
  }

  function attachTooltip(container, points) {
    const tooltip = ensureTooltip(container);

    function hide() {
      tooltip.hidden = true;
      tooltip.classList.remove("below");
      container.querySelectorAll(".is-active").forEach((node) => node.classList.remove("is-active"));
    }

    function show(point) {
      tooltip.innerHTML = point.html;
      tooltip.hidden = false;
      const left = Math.min(Math.max(point.x, 86), container.clientWidth - 86);
      const tooltipHeight = tooltip.offsetHeight || 96;
      const shouldOpenBelow = point.y - tooltipHeight - 22 < 0;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${shouldOpenBelow ? point.y + 14 : point.y - 14}px`;
      tooltip.classList.toggle("below", shouldOpenBelow);
      container.querySelectorAll(".is-active").forEach((node) => node.classList.remove("is-active"));
      container.querySelectorAll(`[data-chart-index="${point.index}"]`).forEach((node) => {
        node.classList.add("is-active");
      });
    }

    function update(event) {
      if (!points.length) return;
      const rect = container.getBoundingClientRect();
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      const localX = clientX - rect.left;
      const closest = points.reduce((best, point) => {
        return Math.abs(point.x - localX) < Math.abs(best.x - localX) ? point : best;
      }, points[0]);
      show(closest);
    }

    container.onmousemove = update;
    container.ontouchstart = update;
    container.ontouchmove = update;
    container.onmouseleave = hide;
    container.ontouchend = hide;
  }

  function dataRows(rows, series) {
    return rows.filter((row) => row.has_data !== false && series.some((item) => row[item.key] !== undefined));
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, Math.abs(height) / 2);
    return `
      M ${x + r} ${y}
      H ${x + width - r}
      Q ${x + width} ${y} ${x + width} ${y + r}
      V ${y + height - r}
      Q ${x + width} ${y + height} ${x + width - r} ${y + height}
      H ${x + r}
      Q ${x} ${y + height} ${x} ${y + height - r}
      V ${y + r}
      Q ${x} ${y} ${x + r} ${y}
      Z
    `;
  }

  function point(row, index, rows, key, width, height, pad, min, max) {
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const x = pad.left + (rows.length <= 1 ? chartWidth / 2 : chartWidth * (index / (rows.length - 1)));
    const range = Math.max(1, max - min);
    const y = pad.top + chartHeight - ((Number(row[key] || 0) - min) / range) * chartHeight;
    return { x, y };
  }

  function renderEnergyChart(container, rows) {
    if (!container) return;
    const width = Math.max(container.clientWidth, 320);
    const height = 318;
    const pad = { top: 26, right: 18, bottom: 46, left: 52 };
    const plotRows = dataRows(rows, [
      { key: "food" },
      { key: "burned" },
      { key: "activity" },
    ]);

    if (!rows.length || !plotRows.length) {
      container.innerHTML = `<div class="empty-chart">No data for this range yet.</div>`;
      return;
    }

    const values = plotRows.flatMap((row) => [Number(row.food || 0), Number(row.burned || 0)]);
    const maxValue = Math.max(...values, 100);
    const niceMax = Math.ceil(maxValue / 500) * 500;
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const baseY = height - pad.bottom;
    const slot = chartWidth / Math.max(rows.length, 1);
    const barWidth = Math.max(8, Math.min(22, slot * 0.56));
    const foodWidth = Math.max(5, barWidth * 0.52);
    const activityWidth = Math.max(4, barWidth * 0.28);
    const ticks = [niceMax, Math.round(niceMax / 2), 0];
    const labelEvery = Math.max(1, Math.ceil(rows.length / 7));

    const grid = ticks
      .map((tick) => {
        const y = pad.top + chartHeight - (tick / niceMax) * chartHeight;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="health-grid-line"></line>
          <text x="8" y="${y + 4}" class="chart-axis-label">${formatValue(tick)}</text>
        `;
      })
      .join("");

    const bars = rows
      .map((row, index) => {
        const x = pad.left + slot * index + slot / 2;
        const label = index % labelEvery === 0 || index === rows.length - 1
          ? `<text x="${x}" y="${height - 14}" class="chart-x-label">${row.date.slice(5)}</text>`
          : "";
        if (row.has_data === false) {
          return `
            <line x1="${x}" y1="${baseY - 8}" x2="${x}" y2="${baseY}" class="health-empty-tick"></line>
            ${label}
          `;
        }

        const burnedHeight = Math.max(4, (Number(row.burned || 0) / niceMax) * chartHeight);
        const foodHeight = Math.max(4, (Number(row.food || 0) / niceMax) * chartHeight);
        const activityHeight = Math.max(3, (Number(row.activity || 0) / niceMax) * chartHeight);
        const burnedY = baseY - burnedHeight;
        const foodY = baseY - foodHeight;
        const activityY = baseY - activityHeight;

        return `
          <path data-chart-index="${index}" class="health-bar health-bar-burned" d="${roundedRect(x - barWidth / 2, burnedY, barWidth, burnedHeight, 8)}" fill="${colors.burned}" opacity="0.18"></path>
          <path data-chart-index="${index}" class="health-bar health-bar-food" d="${roundedRect(x - foodWidth / 2, foodY, foodWidth, foodHeight, 6)}" fill="${colors.food}" opacity="0.92"></path>
          <path data-chart-index="${index}" class="health-bar health-bar-activity" d="${roundedRect(x + barWidth / 2 - activityWidth, activityY, activityWidth, activityHeight, 4)}" fill="${colors.activity}" opacity="0.9"></path>
          ${label}
        `;
      })
      .join("");

    const points = rows
      .map((row, index) => {
        if (row.has_data === false) return null;
        const x = pad.left + slot * index + slot / 2;
        const y = pad.top + chartHeight - (Number(row.burned || row.food || 0) / niceMax) * chartHeight;
        return {
          index,
          x,
          y,
          html: `
            <strong>${escapeHtml(row.date)}</strong>
            <span><i style="background:${colors.food}"></i>Food ${formatValue(row.food)} kcal</span>
            <span><i style="background:${colors.burned}"></i>Burned ${formatValue(row.burned)} kcal</span>
            <span><i style="background:${colors.activity}"></i>Activity ${formatValue(row.activity)} kcal</span>
          `,
        };
      })
      .filter(Boolean);

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg health-chart-svg">
        ${grid}
        ${bars}
      </svg>
    `;
    attachTooltip(container, points);
  }

  function pathFor(rows, key, width, height, pad, min, max) {
    return rows
      .map((row, pathIndex) => {
        const sourceIndex = rows.indexOf(row);
        const p = point(row, sourceIndex, rows, key, width, height, pad, min, max);
        return `${pathIndex === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(" ");
  }

  function renderWeightChart(container, rows) {
    if (!container) return;
    const width = Math.max(container.clientWidth, 320);
    const height = 238;
    const pad = { top: 24, right: 20, bottom: 42, left: 48 };
    const plotRows = rows.filter((row) => row.has_data !== false && row.weight);

    if (!plotRows.length) {
      container.innerHTML = `<div class="empty-chart">No weight logs yet.</div>`;
      return;
    }

    const values = plotRows.map((row) => Number(row.weight));
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const min = Math.floor((rawMin - 1) / 5) * 5;
    const max = Math.ceil((rawMax + 1) / 5) * 5;
    const ticks = [max, Math.round((max + min) / 2), min];
    const labelEvery = Math.max(1, Math.ceil(rows.length / 6));
    const linePath = plotRows
      .map((row, pathIndex) => {
        const sourceIndex = rows.indexOf(row);
        const p = point(row, sourceIndex, rows, "weight", width, height, pad, min, max);
        return `${pathIndex === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(" ");

    const grid = ticks
      .map((tick) => {
        const y = point({ weight: tick }, 0, [0], "weight", width, height, pad, min, max).y;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="health-grid-line"></line>
          <text x="8" y="${y + 4}" class="chart-axis-label">${formatValue(tick)}</text>
        `;
      })
      .join("");

    const dots = plotRows
      .map((row) => {
        const sourceIndex = rows.indexOf(row);
        const p = point(row, sourceIndex, rows, "weight", width, height, pad, min, max);
        return `<circle data-chart-index="${sourceIndex}" cx="${p.x}" cy="${p.y}" r="4.5" fill="${colors.burned}" class="health-dot"></circle>`;
      })
      .join("");

    const xLabels = rows
      .map((row, index) => {
        if (index % labelEvery !== 0 && index !== rows.length - 1) return "";
        const p = point(row, index, rows, "weight", width, height, pad, min, max);
        return `<text x="${p.x}" y="${height - 14}" class="chart-x-label">${row.date.slice(5)}</text>`;
      })
      .join("");

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg health-chart-svg">
        ${grid}
        <path d="${linePath}" fill="none" stroke="${colors.burned}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
        ${dots}
        ${xLabels}
      </svg>
    `;
    attachTooltip(
      container,
      plotRows.map((row) => {
        const sourceIndex = rows.indexOf(row);
        const p = point(row, sourceIndex, rows, "weight", width, height, pad, min, max);
        return {
          index: sourceIndex,
          x: p.x,
          y: p.y,
          html: `
            <strong>${escapeHtml(row.date)}</strong>
            <span><i style="background:${colors.burned}"></i>Weight ${Number(row.weight).toFixed(1)} kg</span>
          `,
        };
      }),
    );
  }

  function renderAll() {
    renderEnergyChart(document.getElementById("calorieChart"), window.MYDIET_TRENDS || []);
    renderWeightChart(document.getElementById("weightChart"), window.MYDIET_WEIGHTS || []);
  }

  window.addEventListener("resize", renderAll);
  renderAll();
})();
