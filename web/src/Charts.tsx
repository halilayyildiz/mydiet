// The dashboard's four charts (Recharts), drawn the way the Flask version drew them by hand:
// evenly spaced days, dots that shrink as the range grows, month names on a year, and a tooltip card per day.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendRow, WeightRow } from "./api.ts";
import { useApp } from "./App.tsx";

type Row = { date: string; has_data: boolean; [key: string]: unknown };

// ---------- Colors and size ----------

function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { muted: v("--muted"), faint: v("--faint"), line: v("--line"), panel: v("--panel"), food: v("--coral"), burned: v("--green"), activity: v("--blue"), red: v("--red") };
}

/** Theme colors, read again when the theme changes. */
function useColors() {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const update = () => setColors(readColors());
    addEventListener("mydiet-theme", update);
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      removeEventListener("mydiet-theme", update);
      media.removeEventListener("change", update);
    };
  }, []);
  return colors;
}

/** The chart box's size (it fills .chart-wrap, whose height the stylesheet sets per screen size). */
function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setSize({ width: Math.max(el.clientWidth, 240), height: el.clientHeight || 220 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

// ---------- Shared helpers (same rules as the old charts) ----------

const dotRadiusFor = (count: number) => (count > 120 ? 1.5 : count > 20 ? 2.4 : 3.6);
// A year of days is too dense for the ring around dots and the empty-day ticks.
const isDense = (rows: Row[]) => rows.length > 120;

function tickStepFor(span: number) {
  return [100, 200, 250, 500, 1000, 2000, 5000].find((step) => step >= span / 5) ?? 10000;
}

function axisTicks(min: number, max: number, step: number) {
  const ticks: number[] = [];
  for (let tick = Math.floor(max / step) * step; tick >= min; tick -= step) ticks.push(tick);
  return ticks;
}

/** Long ranges label month starts with the month name; shorter ones label every few days by day number. */
function xLabelFor(rows: Row[], index: number, every: number, width: number, lang: string) {
  const row = rows[index];
  if (!row) return "";
  if (isDense(rows)) {
    if (row.date.slice(8) !== "01") return "";
    // Twelve month names don't fit side by side on a phone: show every other one there.
    if (width < 560 && Number(row.date.slice(5, 7)) % 2 === 0) return "";
    return new Date(`${row.date}T00:00:00`).toLocaleDateString(lang, { month: "short" });
  }
  const isLabel = (index % every === 0 && rows.length - 1 - index >= every / 2) || index === rows.length - 1;
  return isLabel ? String(Number(row.date.slice(8))) : "";
}

// Today usually has no entry yet; don't leave an empty slot at the end of every chart.
function withoutTrailingEmptyDays<T extends Row>(rows: T[]) {
  let end = rows.length;
  while (end > 1 && rows[end - 1].has_data === false) end -= 1;
  return rows.slice(0, end);
}

const hasAny = (rows: Row[], keys: string[]) => rows.some((row) => row.has_data !== false && keys.some((key) => row[key] !== undefined));

/** Days without data get no value, so lines join their neighbours and no bar is drawn. */
const plotted = (rows: Row[], keys: string[]) =>
  rows.map((row) => (row.has_data === false ? { ...row, ...Object.fromEntries(keys.map((k) => [k, undefined])) } : row));

function useFormat() {
  const { lang } = useApp();
  return {
    lang,
    value: (v: unknown) => Math.round(Number(v || 0)).toLocaleString(lang),
    day: (date: string) => {
      const d = new Date(`${date}T00:00:00`);
      return `${d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" })} · ${d.toLocaleDateString(lang, { weekday: "long" })}`;
    },
  };
}

type TooltipLine = { color: string; label: string; value: string };

function TooltipCard({ title, lines }: { title: string; lines: TooltipLine[] }) {
  return (
    <div className="chart-tooltip chart-tooltip-card">
      <strong>{title}</strong>
      {lines.map((line) => (
        <span className="chart-tooltip-row" key={line.label}>
          <i style={{ background: line.color }}></i>
          <span>{line.label}</span>
          <b>{line.value}</b>
        </span>
      ))}
    </div>
  );
}

/** The tooltip for one day (nothing on days without data). */
function dayTooltip(lines: (row: any) => TooltipLine[] | null, day: (date: string) => string) {
  return ({ active, payload }: { active?: boolean; payload?: readonly { payload?: Row }[] }) => {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    const items = lines(row);
    return items ? <TooltipCard title={day(row.date)} lines={items} /> : null;
  };
}

function Frame({ boxRef, children }: { boxRef: React.RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div ref={boxRef} className="svg-chart">
      {children}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div className="empty-chart">{text}</div>;

/** X-axis labels, plus (outside a year view) a small tick for each day without data. */
function xAxisTick(rows: Row[], every: number, width: number, lang: string, color: string, markEmpty: boolean) {
  return (props: { x?: number | string; y?: number | string; payload?: { index?: number } }) => {
    const index = props.payload?.index ?? 0;
    const x = Number(props.x);
    const y = Number(props.y);
    const label = xLabelFor(rows, index, every, width, lang);
    const empty = markEmpty && !isDense(rows) && rows[index]?.has_data === false;
    return (
      <g>
        {empty && <line x1={x} x2={x} y1={y - 22} y2={y - 14} stroke={color} strokeWidth={2} strokeLinecap="round" />}
        {label && <text x={x} y={y} dy={4} textAnchor="middle" className="chart-x-label">{label}</text>}
      </g>
    );
  };
}

const MARGIN = { top: 12, right: 18, bottom: 4, left: 0 };
const yAxisProps = (ticks: number[], domain: [number, number], format: (v: unknown) => string, width = 48) => ({
  ticks,
  domain,
  width,
  interval: 0 as const,
  axisLine: false,
  tickLine: false,
  allowDataOverflow: true,
  tickFormatter: format,
  tick: { className: "chart-axis-label" },
});

// ---------- Charts ----------

/** Calories burned and eaten each day. */
export function EnergyChart({ rows: allRows }: { rows: TrendRow[] }) {
  const { t } = useApp();
  const colors = useColors();
  const fmt = useFormat();
  const [ref, { width, height }] = useSize();
  const rows = withoutTrailingEmptyDays(allRows as Row[]);
  if (!rows.length || !hasAny(rows, ["food", "burned", "activity"])) return <Frame boxRef={ref}><Empty text={t.chart_dataEmpty} /></Frame>;

  const dataRows = rows.filter((row) => row.has_data !== false);
  const values = dataRows.flatMap((row) => [Number(row.food || 0), Number(row.burned || 0)]);
  const dataMax = Math.max(...values);
  const dataMin = Math.min(...values);
  const margin = Math.max(100, (dataMax - dataMin) * 0.12);
  const niceMax = dataMax + margin;
  const niceMin = Math.max(0, dataMin - margin);
  const ticks = axisTicks(niceMin, niceMax, tickStepFor(niceMax - niceMin));
  const r = dotRadiusFor(rows.length);
  const dense = isDense(rows);
  const dot = (color: string) => ({ r, fill: color, stroke: colors.panel, strokeWidth: dense ? 0 : 1.5 });
  const active = (color: string) => ({ r: 5, fill: color, stroke: colors.panel, strokeWidth: 2.5 });
  const content = dayTooltip(
    (row) => [
      { color: colors.burned, label: t.burned, value: `${fmt.value(row.burned)} kcal` },
      { color: colors.food, label: t.consumed, value: `${fmt.value(row.food)} kcal` },
    ],
    fmt.day,
  );

  return (
    <Frame boxRef={ref}>
      {width > 0 && (
        <LineChart width={width} height={height} data={plotted(rows, ["food", "burned"])} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke={colors.line} />
          <XAxis dataKey="date" interval={0} axisLine={false} tickLine={false} tickMargin={14} padding={{ left: 4, right: 0 }}
            tick={xAxisTick(rows, Math.max(1, Math.ceil(rows.length / 7)), width, fmt.lang, colors.faint, true)} />
          <YAxis {...yAxisProps(ticks, [niceMin, niceMax], fmt.value, 52)} />
          <Tooltip content={content} cursor={{ stroke: colors.faint, strokeDasharray: "3 3" }} isAnimationActive={false} />
          <Line dataKey="burned" stroke={colors.burned} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" dot={dot(colors.burned)} activeDot={active(colors.burned)} connectNulls isAnimationActive={false} />
          <Line dataKey="food" stroke={colors.food} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" dot={dot(colors.food)} activeDot={active(colors.food)} connectNulls isAnimationActive={false} />
        </LineChart>
      )}
    </Frame>
  );
}

/** Active calories each day. */
export function ActivityChart({ rows: allRows }: { rows: TrendRow[] }) {
  const { t } = useApp();
  const colors = useColors();
  const fmt = useFormat();
  const [ref, { width, height }] = useSize();
  const rows = withoutTrailingEmptyDays(allRows as Row[]);
  if (!rows.length || !hasAny(rows, ["activity"])) return <Frame boxRef={ref}><Empty text={t.chart_activityEmpty} /></Frame>;

  const values = rows.filter((row) => row.has_data !== false).map((row) => Number(row.activity || 0));
  const niceMax = Math.ceil(Math.max(...values, 100) / 200) * 200;
  const ticks = Array.from({ length: niceMax / 200 + 1 }, (_, i) => i * 200);
  const slot = (width - 66) / Math.max(rows.length, 1);
  const barSize = Math.max(1.5, Math.min(12, slot * 0.4));
  const content = dayTooltip((row) => [{ color: colors.activity, label: t.activity, value: `${fmt.value(row.activity)} kcal` }], fmt.day);

  return (
    <Frame boxRef={ref}>
      {width > 0 && (
        <BarChart width={width} height={height} data={plotted(rows, ["activity"])} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke={colors.line} />
          <XAxis dataKey="date" interval={0} axisLine={false} tickLine={false} tickMargin={14}
            tick={xAxisTick(rows, Math.max(1, Math.ceil(rows.length / 7)), width, fmt.lang, colors.faint, true)} />
          <YAxis {...yAxisProps(ticks, [0, niceMax], fmt.value)} />
          <Tooltip content={content} cursor={{ fill: colors.line, opacity: 0.5 }} isAnimationActive={false} />
          <Bar dataKey="activity" fill={colors.activity} fillOpacity={0.9} barSize={barSize} radius={Math.min(3, barSize / 2)} minPointSize={4} isAnimationActive={false} />
        </BarChart>
      )}
    </Frame>
  );
}

/** Each day's deficit (up, green) or surplus (down, red). */
export function DeficitChart({ rows: allRows }: { rows: TrendRow[] }) {
  const { t } = useApp();
  const colors = useColors();
  const fmt = useFormat();
  const [ref, { width, height }] = useSize();
  const rows = withoutTrailingEmptyDays(allRows as Row[]);
  if (!rows.length || !hasAny(rows, ["deficit"])) return <Frame boxRef={ref}><Empty text={t.chart_deficitEmpty} /></Frame>;

  const values = rows.filter((row) => row.has_data !== false).map((row) => Number(row.deficit || 0));
  const dataMax = Math.max(...values, 0);
  const dataMin = Math.min(...values, 0);
  const margin = Math.max(50, (dataMax - dataMin) * 0.1);
  const niceMax = dataMax > 0 ? dataMax + margin : margin / 2;
  const niceMin = dataMin < 0 ? dataMin - margin : -margin / 2;
  const ticks = axisTicks(niceMin, niceMax, tickStepFor(niceMax - niceMin));
  const slot = (width - 76) / Math.max(rows.length, 1);
  const barSize = Math.max(1.5, Math.min(12, slot * 0.4));
  const data = plotted(rows, ["deficit"]);
  const content = dayTooltip((row) => {
    const deficit = Number(row.deficit || 0);
    return [{ color: deficit >= 0 ? colors.burned : colors.red, label: deficit >= 0 ? t.deficit : t.surplus, value: `${fmt.value(Math.abs(deficit))} kcal` }];
  }, fmt.day);

  return (
    <Frame boxRef={ref}>
      {width > 0 && (
        <BarChart width={width} height={height} data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke={colors.line} />
          <XAxis dataKey="date" interval={0} axisLine={false} tickLine={false} tickMargin={14}
            tick={xAxisTick(rows, Math.max(1, Math.ceil(rows.length / 7)), width, fmt.lang, colors.faint, false)} />
          <YAxis {...yAxisProps(ticks, [niceMin, niceMax], fmt.value, 58)} />
          <ReferenceLine y={0} stroke={colors.faint} strokeDasharray="3 5" />
          <Tooltip content={content} cursor={{ fill: colors.line, opacity: 0.5 }} isAnimationActive={false} />
          <Bar dataKey="deficit" barSize={barSize} radius={Math.min(3, barSize / 2)} minPointSize={4} isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.date} fill={Number(row.deficit || 0) >= 0 ? colors.burned : colors.red} fillOpacity={0.9} />
            ))}
          </Bar>
        </BarChart>
      )}
    </Frame>
  );
}

/** Body weight: a dot for each weigh-in, the line carried across the days between them. */
export function WeightChart({ rows }: { rows: WeightRow[] }) {
  const { t } = useApp();
  const colors = useColors();
  const fmt = useFormat();
  const [ref, { width, height }] = useSize();
  const all = rows as Row[];
  const withWeight = all.filter((row) => row.weight);
  if (!withWeight.length) return <Frame boxRef={ref}><Empty text={t.chart_weightEmpty} /></Frame>;

  const values = withWeight.map((row) => Number(row.weight));
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  const step = max - min > 12 ? 3 : max - min > 6 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => max - i * step);
  const r = dotRadiusFor(all.length);
  const dense = isDense(all);
  const weightText = (w: unknown) => `${Number(w).toLocaleString(fmt.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
  const measured = (props: any, radius: number, ring: number) =>
    props.payload?.has_data ? (
      <circle key={props.key ?? props.index} cx={props.cx} cy={props.cy} r={radius} fill={colors.burned} stroke={colors.panel} strokeWidth={ring} />
    ) : (
      <g key={props.key ?? props.index} />
    );
  const content = dayTooltip((row) => (row.has_data ? [{ color: colors.burned, label: t.chart_weight, value: weightText(row.weight) }] : null), fmt.day);

  return (
    <Frame boxRef={ref}>
      {width > 0 && (
        <LineChart width={width} height={height} data={all} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke={colors.line} />
          <XAxis dataKey="date" interval={0} axisLine={false} tickLine={false} tickMargin={14} padding={{ left: 4, right: 0 }}
            tick={xAxisTick(all, Math.max(1, Math.ceil(all.length / 6)), width, fmt.lang, colors.faint, false)} />
          <YAxis {...yAxisProps(ticks, [min, max], fmt.value)} />
          <Tooltip content={content} cursor={{ stroke: colors.faint, strokeDasharray: "3 3" }} isAnimationActive={false} />
          <Line dataKey="weight" stroke={colors.burned} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
            dot={(props: any) => measured(props, r, dense ? 0 : 1.5)} activeDot={(props: any) => measured(props, 5, 2.5)} isAnimationActive={false} />
        </LineChart>
      )}
    </Frame>
  );
}
