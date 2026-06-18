(function () {
  const css = getComputedStyle(document.documentElement);
  const colors = {
    muted: css.getPropertyValue("--muted").trim(),
    line: css.getPropertyValue("--line").trim(),
    food: css.getPropertyValue("--coral").trim(),
    burned: css.getPropertyValue("--green").trim(),
    activity: css.getPropertyValue("--blue").trim(),
    red: css.getPropertyValue("--red").trim(),
  };
  const text = {
    activity: "Activity",
    activityEmpty: "No activity logs yet.",
    basal: "Basal",
    burned: "Burned",
    consumed: "Consumed",
    dataEmpty: "No data for this range yet.",
    deficit: "Deficit",
    deficitEmpty: "No deficit logs yet.",
    surplus: "Surplus",
    weight: "Weight",
    weightEmpty: "No weight logs yet.",
    ...(window.MYDIET_CHART_TEXT || {}),
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
      container.innerHTML = `<div class="empty-chart">${escapeHtml(text.dataEmpty)}</div>`;
      return;
    }

    const values = plotRows.flatMap((row) => [Number(row.food || 0), Number(row.burned || 0)]);
    const maxValue = Math.max(...values, 100);
    const niceMax = Math.ceil(maxValue / 500) * 500;
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const baseY = height - pad.bottom;
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

    function energyPath(key) {
      return plotRows
        .map((row, pathIndex) => {
          const sourceIndex = rows.indexOf(row);
          const p = point(row, sourceIndex, rows, key, width, height, pad, 0, niceMax);
          return `${pathIndex === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        })
        .join(" ");
    }

    const xLabelsAndTicks = rows
      .map((row, index) => {
        const p = point(row, index, rows, "burned", width, height, pad, 0, niceMax);
        const label = index % labelEvery === 0 || index === rows.length - 1
          ? `<text x="${p.x}" y="${height - 14}" class="chart-x-label">${Number(row.date.slice(8))}</text>`
          : "";
        const tick = row.has_data === false
          ? `<line x1="${p.x}" y1="${baseY - 8}" x2="${p.x}" y2="${baseY}" class="health-empty-tick"></line>`
          : "";
        return `${tick}${label}`;
      })
      .join("");

    const dots = plotRows
      .flatMap((row) => {
        const sourceIndex = rows.indexOf(row);
        const burnedPoint = point(row, sourceIndex, rows, "burned", width, height, pad, 0, niceMax);
        const foodPoint = point(row, sourceIndex, rows, "food", width, height, pad, 0, niceMax);
        return [
          `<circle data-chart-index="${sourceIndex}" cx="${burnedPoint.x}" cy="${burnedPoint.y}" r="4.8" fill="${colors.burned}" class="health-dot health-dot-burned"></circle>`,
          `<circle data-chart-index="${sourceIndex}" cx="${foodPoint.x}" cy="${foodPoint.y}" r="4.8" fill="${colors.food}" class="health-dot health-dot-food"></circle>`,
        ];
      })
      .join("");

    const points = plotRows
      .map((row, index) => {
        const sourceIndex = rows.indexOf(row);
        const burnedPoint = point(row, sourceIndex, rows, "burned", width, height, pad, 0, niceMax);
        const foodPoint = point(row, sourceIndex, rows, "food", width, height, pad, 0, niceMax);
        const burned = Number(row.burned || 0);
        const activity = Math.min(Number(row.activity || 0), burned);
        const basal = Math.max(burned - activity, 0);
        return {
          index: sourceIndex,
          x: burnedPoint.x,
          y: Math.min(burnedPoint.y, foodPoint.y),
          html: `
            <strong>${escapeHtml(row.date)}</strong>
            <span><i style="background:${colors.food}"></i>${escapeHtml(text.consumed)} ${formatValue(row.food)} kcal</span>
            <span><i style="background:${colors.burned}"></i>${escapeHtml(text.burned)} ${formatValue(burned)} kcal</span>
            <span><i style="background:${colors.burned}"></i>${escapeHtml(text.basal)} ${formatValue(basal)} kcal</span>
            <span><i style="background:${colors.activity}"></i>${escapeHtml(text.activity)} ${formatValue(row.activity)} kcal</span>
          `,
        };
      });

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg health-chart-svg">
        ${grid}
        <path d="${energyPath("burned")}" fill="none" stroke="${colors.burned}" class="health-line health-line-burned"></path>
        <path d="${energyPath("food")}" fill="none" stroke="${colors.food}" class="health-line health-line-food"></path>
        ${dots}
        ${xLabelsAndTicks}
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

  function renderActivityChart(container, rows) {
    if (!container) return;
    const width = Math.max(container.clientWidth, 320);
    const height = 238;
    const pad = { top: 24, right: 20, bottom: 42, left: 48 };
    const plotRows = dataRows(rows, [{ key: "activity" }]);

    if (!rows.length || !plotRows.length) {
      container.innerHTML = `<div class="empty-chart">${escapeHtml(text.activityEmpty)}</div>`;
      return;
    }

    const values = plotRows.map((row) => Number(row.activity || 0));
    const maxValue = Math.max(...values, 100);
    const niceMax = Math.ceil(maxValue / 100) * 100;
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const baseY = height - pad.bottom;
    const slot = chartWidth / Math.max(rows.length, 1);
    const barWidth = Math.max(8, Math.min(24, slot * 0.52));
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
        const x = pad.left + (rows.length <= 1 ? chartWidth / 2 : chartWidth * (index / (rows.length - 1)));
        const label = index % labelEvery === 0 || index === rows.length - 1
          ? `<text x="${x}" y="${height - 14}" class="chart-x-label">${Number(row.date.slice(8))}</text>`
          : "";
        if (row.has_data === false) {
          return `
            <line x1="${x}" y1="${baseY - 8}" x2="${x}" y2="${baseY}" class="health-empty-tick"></line>
            ${label}
          `;
        }

        const activity = Number(row.activity || 0);
        const barHeight = Math.max(4, (activity / niceMax) * chartHeight);
        const y = baseY - barHeight;
        return `
          <rect data-chart-index="${index}" class="health-bar health-bar-activity" x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeight}" rx="7" fill="${colors.activity}" opacity="0.9"></rect>
          ${label}
        `;
      })
      .join("");

    const points = plotRows.map((row) => {
      const sourceIndex = rows.indexOf(row);
      const x = pad.left + (rows.length <= 1 ? chartWidth / 2 : chartWidth * (sourceIndex / (rows.length - 1)));
      const y = pad.top + chartHeight - (Number(row.activity || 0) / niceMax) * chartHeight;
      return {
        index: sourceIndex,
        x,
        y,
        html: `
          <strong>${escapeHtml(row.date)}</strong>
          <span><i style="background:${colors.activity}"></i>${escapeHtml(text.activity)} ${formatValue(row.activity)} kcal</span>
        `,
      };
    });

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg health-chart-svg">
        ${grid}
        ${bars}
      </svg>
    `;
    attachTooltip(container, points);
  }

  function renderDeficitChart(container, rows) {
    if (!container) return;
    const width = Math.max(container.clientWidth, 320);
    const height = 238;
    const pad = { top: 24, right: 20, bottom: 42, left: 58 };
    const plotRows = dataRows(rows, [{ key: "deficit" }]);

    if (!rows.length || !plotRows.length) {
      container.innerHTML = `<div class="empty-chart">${escapeHtml(text.deficitEmpty)}</div>`;
      return;
    }

    const values = plotRows.map((row) => Math.abs(Number(row.deficit || 0)));
    const maxValue = Math.max(...values, 100);
    const tickStep = 500;
    const niceMax = Math.max(tickStep, Math.ceil(maxValue / tickStep) * tickStep);
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const zeroY = point({ deficit: 0 }, 0, [0], "deficit", width, height, pad, -niceMax, niceMax).y;
    const slot = chartWidth / Math.max(rows.length, 1);
    const barWidth = Math.max(8, Math.min(24, slot * 0.52));
    const ticks = [];
    for (let tick = niceMax; tick >= -niceMax; tick -= tickStep) {
      ticks.push(tick);
    }
    const labelEvery = Math.max(1, Math.ceil(rows.length / 7));

    const grid = ticks
      .map((tick) => {
        const y = point({ deficit: tick }, 0, [0], "deficit", width, height, pad, -niceMax, niceMax).y;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="${tick === 0 ? "health-zero-line" : "health-grid-line"}"></line>
          <text x="8" y="${y + 4}" class="chart-axis-label">${formatValue(tick)}</text>
        `;
      })
      .join("");

    const bars = rows
      .map((row, index) => {
        const x = pad.left + (rows.length <= 1 ? chartWidth / 2 : chartWidth * (index / (rows.length - 1)));
        const label = index % labelEvery === 0 || index === rows.length - 1
          ? `<text x="${x}" y="${height - 14}" class="chart-x-label">${Number(row.date.slice(8))}</text>`
          : "";
        if (row.has_data === false) {
          return `
            <line x1="${x}" y1="${zeroY - 5}" x2="${x}" y2="${zeroY + 5}" class="health-empty-tick"></line>
            ${label}
          `;
        }

        const deficit = Number(row.deficit || 0);
        const y = point(row, index, rows, "deficit", width, height, pad, -niceMax, niceMax).y;
        const barHeight = Math.max(4, Math.abs(y - zeroY));
        const barY = deficit >= 0 ? y : zeroY;
        const fill = deficit >= 0 ? colors.burned : colors.red;
        return `
          <rect data-chart-index="${index}" class="health-bar health-bar-deficit" x="${x - barWidth / 2}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="7" fill="${fill}" opacity="0.9"></rect>
          ${label}
        `;
      })
      .join("");

    const points = plotRows.map((row) => {
      const sourceIndex = rows.indexOf(row);
      const p = point(row, sourceIndex, rows, "deficit", width, height, pad, -niceMax, niceMax);
      const deficit = Number(row.deficit || 0);
      const color = deficit >= 0 ? colors.burned : colors.red;
      const label = deficit >= 0 ? text.deficit : text.surplus;
      return {
        index: sourceIndex,
        x: p.x,
        y: p.y,
        html: `
          <strong>${escapeHtml(row.date)}</strong>
          <span><i style="background:${color}"></i>${label} ${formatValue(Math.abs(deficit))} kcal</span>
        `,
      };
    });

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="chart-svg health-chart-svg">
        ${grid}
        ${bars}
      </svg>
    `;
    attachTooltip(container, points);
  }

  function renderWeightChart(container, rows) {
    if (!container) return;
    const width = Math.max(container.clientWidth, 320);
    const height = 238;
    const pad = { top: 24, right: 20, bottom: 42, left: 48 };
    const plotRows = rows.filter((row) => row.has_data !== false && row.weight);

    if (!plotRows.length) {
      container.innerHTML = `<div class="empty-chart">${escapeHtml(text.weightEmpty)}</div>`;
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
        return `<text x="${p.x}" y="${height - 14}" class="chart-x-label">${Number(row.date.slice(8))}</text>`;
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
            <span><i style="background:${colors.burned}"></i>${escapeHtml(text.weight)} ${Number(row.weight).toFixed(1)} kg</span>
          `,
        };
      }),
    );
  }

  function renderAll() {
    renderEnergyChart(document.getElementById("calorieChart"), window.MYDIET_TRENDS || []);
    renderActivityChart(document.getElementById("activityChart"), window.MYDIET_TRENDS || []);
    renderDeficitChart(document.getElementById("deficitChart"), window.MYDIET_TRENDS || []);
    renderWeightChart(document.getElementById("weightChart"), window.MYDIET_WEIGHTS || []);
  }

  window.addEventListener("resize", renderAll);
  renderAll();
})();
