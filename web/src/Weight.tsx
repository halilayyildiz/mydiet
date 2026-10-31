import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { FormStatus, kg, shortDate, useApp, useData } from "./App.tsx";

export function Weight() {
  const { t, lang, errorText, flash } = useApp();
  const [version, setVersion] = useState(0);
  const [data] = useData(() => api.weight(), `${version}`);
  const [date, setDate] = useState("");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDate(data.today);
    setWeight(data.currentWeight != null ? kg(data.currentWeight) : "");
  }, [data]);

  useEffect(() => {
    document.title = `${t.weight} · MyDiet`;
  }, [t]);

  const step = (delta: number) => {
    const current = Number.parseFloat(weight.replace(",", "."));
    setWeight(Math.max((Number.isFinite(current) ? current : 0) + delta, 0).toFixed(1));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!weight.trim()) {
      flash("error", t.enter_weight);
      return;
    }
    setBusy(true);
    try {
      await api.saveWeight(date, weight);
      flash("success", t.weight_logged);
      setVersion((v) => v + 1);
    } catch (err) {
      flash("error", errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="toolbar">
        <div>
          <p className="eyebrow">{t.body_weight}</p>
          <h1>{t.weight_log}</h1>
        </div>
      </section>

      <section className="weight-layout">
        <form className={`weight-log-panel${busy ? " is-submitting" : ""}`} onSubmit={submit} aria-busy={busy}>
          <FormStatus message={busy ? t.logging_weight : null} />
          <label>
            {t.date}
            <input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            {t.weight}
            <div className="weight-stepper">
              <button type="button" onClick={() => step(-0.1)} aria-label="-0.1 kg">−</button>
              <input type="text" name="weight_kg" inputMode="decimal" pattern="[0-9]+([\.,][0-9]+)?" value={weight}
                onChange={(e) => setWeight(e.target.value)} placeholder="82.4" required />
              <button type="button" onClick={() => step(0.1)} aria-label="+0.1 kg">+</button>
            </div>
          </label>
          <button type="submit" disabled={busy}>{busy ? t.logging : t.log_weight}</button>
        </form>

        <section className="result-panel">
          <h2>{t.recent_weights}</h2>
          {data && data.logs.length > 0 ? (
            <dl className="analysis-list">
              {data.logs.map((log) => (
                <div key={log.date}><dt>{shortDate(log.date, lang)}</dt><dd>{kg(log.weight_kg)} kg</dd></div>
              ))}
            </dl>
          ) : (
            data && <p className="muted">{t.no_weight_logs}</p>
          )}
        </section>
      </section>
    </>
  );
}
