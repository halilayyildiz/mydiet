import { useState, type FormEvent } from "react";
import { api } from "./api.ts";
import { FlashStack, useApp, type Flash } from "./App.tsx";
import { Link, useRouter } from "./router.tsx";

function AuthPanel({ flash, children }: { flash: Flash; children: React.ReactNode }) {
  return (
    <div className="login-body">
      <main className="login-panel">
        <div className="brandmark login-brand">
          <img className="brand-icon" src="/static/favicon.svg" alt="" />
          <span>MyDiet</span>
        </div>
        <FlashStack flash={flash} className="login-flash-stack" />
        {children}
      </main>
    </div>
  );
}

export function Login({ flash }: { flash: Flash }) {
  const { t, errorText, flash: show, refreshSession } = useApp();
  const { query, navigate } = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api.login(username, password);
      await refreshSession();
      const next = query.get("next");
      if (result.needsProfile) {
        show("error", t.complete_profile_first, "/profile");
        navigate("/profile");
      } else {
        navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      }
    } catch (err) {
      show("error", errorText(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPanel flash={flash}>
      <form className="stack-form" onSubmit={submit}>
        <label>
          {t.username}
          <input name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus />
        </label>
        <label>
          {t.password}
          <input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={busy}>{t.enter}</button>
      </form>
      <p className="auth-switch">
        <Link href="/register">{t.register}</Link>
        <span aria-hidden="true"> · </span>
        <a href="/demo">{t.try_demo}</a>
      </p>
      <p className="auth-switch muted small">{t.forgot_password}</p>
    </AuthPanel>
  );
}

export function Register({ flash }: { flash: Flash }) {
  const { t, errorText, flash: show, refreshSession } = useApp();
  const { navigate } = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.register(username, password);
      await refreshSession();
      show("success", t.user_created, "/profile");
      navigate("/profile");
    } catch (err) {
      show("error", errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPanel flash={flash}>
      <form className="stack-form" onSubmit={submit}>
        <label>
          {t.username}
          <input name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus />
        </label>
        <label>
          {t.password}
          <input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <button type="submit" disabled={busy}>{t.create_account}</button>
      </form>
      <p className="auth-switch">
        {t.have_account} <Link href="/login">{t.enter}</Link>
      </p>
    </AuthPanel>
  );
}

/** Opened from a reset link the admin sent: choose a new password. */
export function ResetPassword({ flash }: { flash: Flash }) {
  const { t, errorText, flash: show } = useApp();
  const { query, navigate } = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.resetPassword(query.get("token") ?? "", password);
      show("success", t.password_reset_done, "/login");
      navigate("/login");
    } catch (err) {
      show("error", errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPanel flash={flash}>
      <form className="stack-form" onSubmit={submit}>
        <label>
          {t.new_password}
          <input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus />
        </label>
        <button type="submit" disabled={busy}>{t.set_new_password}</button>
      </form>
      <p className="auth-switch">
        <Link href="/login">{t.enter}</Link>
      </p>
    </AuthPanel>
  );
}
