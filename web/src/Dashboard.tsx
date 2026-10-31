import { useEffect, useState } from "react";
import { api, type CalendarData } from "./api.ts";
import { useApp, useData } from "./App.tsx";
import { Link, useRouter } from "./router.tsx";
import { ActivityChart, DeficitChart, EnergyChart, WeightChart } from "./Charts.tsx";

const WEEKDAYS: Record<string, string[]> = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  tr: ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"],
};

export function Dashboard() {
  const { t, lang } = useApp();
  const { query, navigate } = useRouter();
  const range = query.get("range") || "14d";
  const month = query.get("month") || "";
  // The calendar changes month on its own; the rest of the page reloads only for a new range or language.
  const [data] = useData(() => api.dashboard(range, month), `${range}|${lang}`);

  useEffect(() => {
    document.title = `${t.dashboard} · MyDiet`;
  }, [t]);

  if (!data) return null;
  const b = data.balance;
  const days = data.rangeDays;
  const avgDeficit = data.averages.deficit || 0;
  const pageUrl = (params: Record<string, string>) => {
    const q = new URLSearchParams({ range: data.range, ...(month ? { month } : {}), ...params });
    return `/?${q}`;
  };

  return (
    <>
      <section className="toolbar">
        <div>
          <p className="eyebrow">{t.personal_dashboard}</p>
          <h1>{t.daily_calorie_balance}</h1>
        </div>
        <div className="range-control">
          {Object.entries(data.rangeOptions).map(([key, n]) => (
            <button key={key} type="button" className={data.range === key ? "selected" : ""} onClick={() => navigate(pageUrl({ range: key }))}>
              {n === 365 ? t.one_year : `${n} ${t.days}`}
            </button>
          ))}
        </div>
      </section>

      <section className={`balance-card ${b.deficit >= 0 ? "positive" : "negative"}`} aria-label={t.daily_average_energy_balance}>
        <div className="balance-head">
          <div>
            <p className="eyebrow">{t.daily_average}</p>
            <h2>{t.energy_balance}</h2>
          </div>
          <div className="balance-result">
            <span>{b.deficit >= 0 ? t.deficit : t.surplus}</span>
            <strong>{Math.abs(b.deficit)}</strong>
            <small>{t.kcal_per_day}</small>
          </div>
        </div>
        <div className="balance-bars">
          <div className="balance-row">
            <div className="balance-label">
              <span><i className="balance-emoji" aria-hidden="true">🍽</i>{t.eaten}</span>
              <strong>{b.food} kcal</strong>
            </div>
            <div className="balance-track" aria-hidden="true">
              <span className="balance-fill food" style={{ width: `${b.food_pct}%` }}></span>
            </div>
          </div>
          <div className="balance-row">
            <div className="balance-label">
              <span><i className="balance-emoji" aria-hidden="true">🔥</i>{t.burned}</span>
              <strong>{b.burned} kcal</strong>
            </div>
            <div className="balance-track stacked" aria-hidden="true">
              <span className="balance-fill basal" style={{ width: `${b.basal_pct}%` }}></span>
              <span className="balance-fill activity" style={{ width: `${b.activity_pct}%` }}></span>
            </div>
            <div className="balance-breakdown">
              <span><i className="swatch burned"></i>{t.basal} {b.basal} kcal</span>
              <span><i className="swatch activity"></i>{t.activity} {b.activity} kcal</span>
            </div>
          </div>
        </div>
      </section>

      <section className="chart-section">
        <div className="section-heading">
          <div>
            <h2>{days === 365 ? t.last_year : t.last_days.replace("{days}", String(days))}</h2>
            <p className="section-subtitle">{data.rangeLabel} · {data.recordedDays} {t.recorded_days}</p>
          </div>
          <Link href={`/entry?date=${data.today}`}>{t.add_today}</Link>
        </div>
        <div className="chart-wrap compact">
          <EnergyChart rows={data.trends} />
        </div>
        <div className="legend">
          <span><i className="swatch burned"></i>{t.burned}</span>
          <span><i className="swatch food"></i>{t.consumed}</span>
        </div>
      </section>

      <section className="chart-section">
        <div className="section-heading with-stat">
          <div>
            <h2>{t.activity_trend}</h2>
            <p className="section-subtitle">{t.active_calories_by_day}</p>
          </div>
          <div className="panel-average-stat activity">
            <strong>{data.averages.activity}</strong>
            <small>{t.kcal_per_day}</small>
          </div>
        </div>
        <div className="chart-wrap compact">
          <ActivityChart rows={data.trends} />
        </div>
        <div className="legend">
          <span><i className="swatch activity"></i>{t.activity_calories}</span>
        </div>
      </section>

      <section className="chart-section">
        <div className="section-heading with-stat">
          <div>
            <h2>{t.calorie_deficit_trend}</h2>
            <p className="section-subtitle">{t.daily_deficit_or_surplus}</p>
          </div>
          <div className={`panel-average-stat ${avgDeficit >= 0 ? "positive" : "negative"}`}>
            <strong>{Math.abs(avgDeficit)}</strong>
            <small>{t.kcal_per_day}</small>
          </div>
        </div>
        <div className="chart-wrap compact">
          <DeficitChart rows={data.trends} />
        </div>
        <div className="legend">
          <span><i className="swatch burned"></i>{t.deficit}</span>
          <span><i className="swatch deficit-negative"></i>{t.surplus}</span>
        </div>
      </section>

      <section className="chart-section">
        <div className="section-heading">
          <h2>{t.weight_trend}</h2>
          <Link href="/weight">{t.update_weight}</Link>
        </div>
        <div className="chart-wrap compact">
          <WeightChart rows={data.weights} />
        </div>
      </section>

      <Calendar initial={data.calendar} range={data.range} />
    </>
  );
}

function Calendar({ initial, range }: { initial: CalendarData; range: string }) {
  const { t, lang } = useApp();
  const { query, navigate } = useRouter();
  const [cal, setCal] = useState(initial);
  const [loading, setLoading] = useState(false);
  const month = query.get("month") || initial.month;

  useEffect(() => setCal(initial), [initial]);

  // Changing month updates the address (so back/forward work) and reloads only the calendar.
  useEffect(() => {
    if (month === cal.month) return;
    let live = true;
    setLoading(true);
    api.calendar(month)
      .then((c) => live && setCal(c))
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [month]);

  const go = (m: string) => navigate(`/?${new URLSearchParams({ range, month: m })}`, { replace: false });

  return (
    <section className={`calendar-section${loading ? " is-loading" : ""}`} aria-busy={loading}>
      <div className="section-heading">
        <h2>{t.calorie_deficit_calendar}</h2>
        <form className="month-form" onSubmit={(e) => e.preventDefault()}>
          <a className="month-step" href={`/?range=${range}&month=${cal.previous}`} aria-label={t.previous_month}
            onClick={(e) => { e.preventDefault(); go(cal.previous); }}>‹</a>
          <input type="month" name="month" value={cal.month} aria-label={t.calendar_month} onChange={(e) => e.target.value && go(e.target.value)} />
          <a className="month-step" href={`/?range=${range}&month=${cal.next}`} aria-label={t.next_month}
            onClick={(e) => { e.preventDefault(); go(cal.next); }}>›</a>
        </form>
      </div>
      <div className="weekday-grid" aria-hidden="true">
        {(WEEKDAYS[lang] ?? WEEKDAYS.en).map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="calendar-grid">
        {Array.from({ length: cal.blanks }, (_, i) => <div key={`blank-${i}`} className="calendar-day blank"></div>)}
        {cal.days.map((day) => (
          <Link key={day.date} className={`calendar-day ${day.tone}`} href={`/entry?date=${day.date}`}>
            <span className="calendar-date">{day.day}</span>
            {day.logged && (
              <>
                <strong className="calendar-deficit">{day.deficit}</strong>
                <span className="calendar-unit">kcal</span>
              </>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
