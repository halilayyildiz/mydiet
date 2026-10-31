import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { FormStatus, useApp, useData } from "./App.tsx";
import { useRouter } from "./router.tsx";

export function Entry() {
  const { t, session, errorText, flash, lang } = useApp();
  const { query, navigate } = useRouter();
  const date = query.get("date") || session.today;
  const [data, setData] = useData(() => api.entry(date), `${date}|${lang}`);
  const [formDate, setFormDate] = useState(date);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setFormDate(data.date);
    setText(data.entry.diary_text ?? "");
  }, [data]);

  useEffect(() => {
    document.title = `${t.entry} · MyDiet`;
  }, [t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.saveEntry(formDate, text);
      const href = `/entry?date=${result.date}`;
      flash("success", t.day_saved, href);
      if (href !== location.pathname + location.search) navigate(href, { replace: true });
      setData(result);
    } catch (err) {
      flash("error", errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const analysis = data?.entry.analysis;
  const label = (key: string) => (t as Record<string, string>)[key] ?? key;

  return (
    <>
      <section className="toolbar">
        <div>
          <p className="eyebrow">{t.entry}</p>
          <h1>{t.what_happened_today}</h1>
        </div>
      </section>

      <section className="form-layout">
        <form className={`stack-form${busy ? " is-submitting" : ""}`} onSubmit={submit} aria-busy={busy}>
          <FormStatus message={busy ? t.analyzing_day : null} />
          <label>
            {t.date}
            <input type="date" name="date" value={formDate} onChange={(e) => {
              setFormDate(e.target.value);
              if (e.target.value) navigate(`/entry?date=${e.target.value}`, { replace: true });
            }} required />
          </label>
          <label>
            {t.food_and_activity_notes}
            <textarea name="diary_text" rows={18} placeholder={t.diary_placeholder} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>{busy ? t.analyzing : t.analyze_day}</button>
        </form>

        <section className="result-panel">
          <h2>{t.analysis}</h2>
          {analysis ? (
            <>
              <dl className="analysis-list">
                <div><dt>{t.food}</dt><dd>{analysis.food_calories} kcal</dd></div>
                <div><dt>{t.basal}</dt><dd>{analysis.bmr_calories || 0} kcal</dd></div>
                <div><dt>{t.burned}</dt><dd>{analysis.burned_calories} kcal</dd></div>
                <div><dt>{t.activity}</dt><dd>{analysis.activity_calories} kcal</dd></div>
                <div><dt>{t.deficit}</dt><dd>{analysis.calorie_deficit} kcal</dd></div>
                <div><dt>{t.confidence}</dt><dd>{analysis.confidence}</dd></div>
              </dl>
              <div className="macro-summary" aria-label="Daily macro estimate">
                <div><span>{t.protein}</span><strong>{analysis.protein_g || 0}g</strong></div>
                <div><span>{t.carbs}</span><strong>{analysis.carbs_g || 0}g</strong></div>
                <div><span>{t.fat}</span><strong>{analysis.fat_g || 0}g</strong></div>
              </div>
              {data.foodGroups.length > 0 && (
                <section className="food-breakdown">
                  <h3>{t.food_breakdown}</h3>
                  <div className="food-groups">
                    {data.foodGroups.map((group) => (
                      <section className="food-group" key={group.key}>
                        <div className="food-group-heading">
                          <h4>{label(group.key)}</h4>
                          <strong>{group.calories} kcal</strong>
                        </div>
                        <div className="food-list">
                          {group.items.map((item, i) => (
                            <article className="food-item" key={i}>
                              <div>
                                <strong>{item.name}</strong>
                                <span>
                                  {item.protein_g || 0}g {t.protein.toLocaleLowerCase(lang)} · {item.carbs_g || 0}g {t.carbs.toLocaleLowerCase(lang)} · {item.fat_g || 0}g {t.fat.toLocaleLowerCase(lang)}
                                </span>
                              </div>
                              <b>{item.calories || 0} kcal</b>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>
              )}
              <p>{analysis.summary}</p>
              {analysis.assumptions && analysis.assumptions.length > 0 && (
                <ul className="assumptions">
                  {analysis.assumptions.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              )}
            </>
          ) : (
            data && <p className="muted">{t.no_analysis}</p>
          )}
          {data?.entry.image_urls && data.entry.image_urls.length > 0 && (
            <div className="photo-grid">
              {data.entry.image_urls.map((src) => <img key={src} src={src} alt="Uploaded meal or activity reference" />)}
            </div>
          )}
        </section>
      </section>
    </>
  );
}
