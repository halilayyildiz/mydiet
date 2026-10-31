import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { FormStatus, kg, useApp, useData } from "./App.tsx";
import { useRouter } from "./router.tsx";

const FIELDS = ["name", "age", "gender", "height_cm", "weight_kg", "goal_weight_kg", "activity_level", "goal"] as const;
type Form = Record<(typeof FIELDS)[number], string>;

const MULTIPLIERS: Record<string, number> = { low: 1.1, moderate: 1.25, high: 1.45 };

/** Same formula as the server: Mifflin-St Jeor times the everyday activity level. */
function bmrPreview(form: Form): number {
  const num = (value: string, fallback: number) => {
    const n = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };
  const raw = 10 * num(form.weight_kg, 80) + 6.25 * num(form.height_cm, 175) - 5 * num(form.age, 35) + (form.gender.toLowerCase() === "male" ? 5 : -161);
  return Math.round(raw * (MULTIPLIERS[form.activity_level.toLowerCase()] ?? MULTIPLIERS.low));
}

export function ProfilePage() {
  const { t, errorText, flash, refreshSession } = useApp();
  const { navigate } = useRouter();
  const [data] = useData(() => api.profile(), "profile");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const p = data.profile;
    const value = (key: string) => (p[key] === null || p[key] === undefined ? "" : String(p[key]));
    // Like the old form: a select without a stored value shows its first option.
    setForm({
      ...(Object.fromEntries(FIELDS.map((key) => [key, value(key)])) as Form),
      weight_kg: value("weight_kg") && kg(p.weight_kg),
      goal_weight_kg: value("goal_weight_kg") && kg(p.goal_weight_kg),
      gender: value("gender") || "male",
      activity_level: value("activity_level") || "low",
      goal: value("goal") || "fat_loss",
    });
  }, [data]);

  useEffect(() => {
    document.title = `${t.profile} · MyDiet`;
  }, [t]);

  if (!form) return null;
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.saveProfile(form);
      const session = await refreshSession();
      if (!result.complete || session.needsProfile) {
        flash("error", t.complete_profile_first);
      } else {
        flash("success", t.profile_saved, "/");
        navigate("/");
      }
    } catch (err) {
      flash("error", errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const options = (pairs: [string, string][]) => pairs.map(([value, label]) => <option key={value} value={value}>{label}</option>);

  return (
    <>
      <section className="toolbar">
        <div>
          <p className="eyebrow">{t.personal_settings}</p>
          <h1>{t.profile}</h1>
        </div>
      </section>

      <form className={`profile-grid${busy ? " is-submitting" : ""}`} onSubmit={submit} aria-busy={busy}>
        <FormStatus message={busy ? t.saving_profile : null} />
        <label>
          {t.name}
          <input name="name" value={form.name} onChange={set("name")} autoComplete="name" />
        </label>
        <label>
          {t.age}
          <input type="number" name="age" value={form.age} onChange={set("age")} min={1} max={120} required />
        </label>
        <label>
          {t.gender}
          <select name="gender" value={form.gender} onChange={set("gender")} required>
            {options([["male", t.male], ["female", t.female], ["other", t.other]])}
          </select>
        </label>
        <label>
          {t.height} (cm)
          <input type="number" name="height_cm" value={form.height_cm} onChange={set("height_cm")} min={80} max={240} required />
        </label>
        <label>
          {t.current_weight} (kg)
          <input type="text" name="weight_kg" value={form.weight_kg} onChange={set("weight_kg")} inputMode="decimal" pattern="[0-9]+([\.,][0-9]+)?" required />
        </label>
        <label>
          {t.goal_weight} (kg)
          <input type="text" name="goal_weight_kg" value={form.goal_weight_kg} onChange={set("goal_weight_kg")} inputMode="decimal" pattern="[0-9]+([\.,][0-9]+)?" />
        </label>
        <label>
          {t.activity_level}
          <select name="activity_level" value={form.activity_level} onChange={set("activity_level")} required>
            {options([["low", t.low], ["moderate", t.moderate], ["high", t.high]])}
          </select>
        </label>
        <div className="profile-bmr-preview" aria-live="polite">
          <span>{t.calculated_basal}</span>
          <strong><span>{bmrPreview(form)}</span> kcal</strong>
        </div>
        <label>
          {t.goal}
          <select name="goal" value={form.goal} onChange={set("goal")} required>
            {options([["fat_loss", t.fat_loss], ["maintenance", t.maintenance], ["muscle_gain", t.muscle_gain]])}
          </select>
        </label>
        <button type="submit" disabled={busy}>{busy ? t.saving : t.save_profile}</button>
      </form>
    </>
  );
}
