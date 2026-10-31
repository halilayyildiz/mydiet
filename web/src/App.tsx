import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Session } from "./api.ts";
import { textsFor, type Texts } from "./i18n.ts";
import { Link, RouterProvider, useRouter, useRouterState } from "./router.tsx";
import { currentTheme, setTheme, type Theme } from "./theme.ts";
import { Dashboard } from "./Dashboard.tsx";
import { Entry } from "./Entry.tsx";
import { Weight } from "./Weight.tsx";
import { ProfilePage } from "./Profile.tsx";
import { Login, Register } from "./Login.tsx";

/** A message at the top of one page: it shows while that page (href) is open. */
export type Flash = { kind: "success" | "error"; text: string; href: string } | null;

type AppCtx = {
  session: Session;
  t: Texts;
  lang: string;
  /** Show a message at the top of the page; pass `href` when about to go to another page. */
  flash: (kind: "success" | "error", text: string, href?: string) => void;
  /** An error's message in the current language. */
  errorText: (e: unknown) => string;
  refreshSession: () => Promise<Session>;
};

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => useContext(Ctx)!;

export function App() {
  const router = useRouterState();
  const [session, setSession] = useState<Session | null>(null);
  const [flashState, setFlash] = useState<Flash>(null);
  const flash = flashState && flashState.href === router.href ? flashState : null;

  const refreshSession = useCallback(async () => {
    const s = await api.session();
    setSession(s);
    return s;
  }, []);

  useEffect(() => {
    refreshSession().catch(() => setSession(null));
  }, [refreshSession]);

  const lang = session?.lang ?? "en";
  const t = textsFor(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Signed-in users fill in their profile first.
  useEffect(() => {
    if (session?.authenticated && session.needsProfile && router.path !== "/profile" && !["/login", "/register"].includes(router.path)) {
      setFlash({ kind: "error", text: t.complete_profile_first, href: "/profile" });
      router.navigate("/profile", { replace: true });
    }
  }, [session, router.path]);

  if (!session) return null;

  const ctx: AppCtx = {
    session,
    t,
    lang,
    flash: (kind, text, href) => setFlash({ kind, text, href: href ?? location.pathname + location.search }),
    errorText: (e) => {
      const code = e instanceof ApiError ? e.code : "server_error";
      return (t as Record<string, string>)[code] ?? t.server_error;
    },
    refreshSession,
  };

  const authPage = router.path === "/login" || router.path === "/register";
  return (
    <RouterProvider value={router}>
      <Ctx.Provider value={ctx}>
        {authPage ? (
          router.path === "/login" ? <Login flash={flash} /> : <Register flash={flash} />
        ) : (
          <Shell flash={flash}>
            <Page />
          </Shell>
        )}
      </Ctx.Provider>
    </RouterProvider>
  );
}

function Page() {
  const { path } = useRouter();
  if (path === "/entry") return <Entry />;
  if (path === "/weight") return <Weight />;
  if (path === "/profile") return <ProfilePage />;
  return <Dashboard />;
}

export function FlashStack({ flash, className = "flash-stack" }: { flash: Flash; className?: string }) {
  if (!flash) return null;
  return (
    <div className={className}>
      <div className={`flash ${flash.kind}`}>{flash.text}</div>
    </div>
  );
}

function Shell({ flash, children }: { flash: Flash; children: ReactNode }) {
  const { session, t, lang, refreshSession } = useApp();
  const { href } = useRouter();
  const menu = useRef<HTMLDetailsElement>(null);
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  const [copied, setCopied] = useState(false);
  const username = session.username ?? "";

  // The account menu closes on a click outside it, on Escape, and after a page change.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu.current) menu.current.open = false;
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [href]);

  const chooseLang = async (next: string) => {
    if (next === lang) return;
    await api.setLanguage(next);
    await refreshSession();
  };

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };

  const copyDemoLink = async () => {
    const url = `${location.origin}/demo`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const logout = async () => {
    await api.logout();
    location.href = "/login";
  };

  return (
    <>
      <header className="site-header">
        <Link className="brandmark" href="/" aria-label="MyDiet home">
          <img className="brand-icon" src="/static/favicon.svg" alt="" />
          <span>MyDiet</span>
        </Link>
        <details className="header-menu account-menu" ref={menu}>
          <summary className="header-menu-button" aria-label={username}>
            <span className="avatar" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
            <span>{username}</span>
          </summary>
          <div className="header-menu-panel">
            <Link className={href.startsWith("/profile") ? "active" : ""} href="/profile">{t.profile}</Link>
            <div className="language-switch" role="group" aria-label={t.language}>
              <span>{t.language}</span>
              <div className="segmented">
                {["tr", "en"].map((l) => (
                  <button key={l} type="button" className={lang === l ? "active" : ""} onClick={() => chooseLang(l)}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="language-switch" role="group" aria-label={t.theme}>
              <span>{t.theme}</span>
              <div className="segmented">
                <button type="button" className={theme === "light" ? "active" : ""} onClick={() => chooseTheme("light")}>{t.theme_light}</button>
                <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => chooseTheme("dark")}>{t.theme_dark}</button>
              </div>
            </div>
            <button type="button" onClick={copyDemoLink}>{copied ? `✓ ${t.link_copied}` : t.copy_demo_link}</button>
            <button className="menu-logout" type="button" onClick={logout}>{t.log_out}</button>
          </div>
        </details>
      </header>

      <FlashStack flash={flash} />

      {session.demo && (
        <div className="demo-banner">
          <span>{t.demo_banner}</span>
          <a href="/demo/exit">{t.demo_exit}</a>
        </div>
      )}

      <main className="page-shell">{children}</main>
    </>
  );
}

/** Loads a page's data, again whenever `key` changes; keeps showing the previous data while reloading. */
export function useData<T>(load: () => Promise<T>, key: string): [T | null, (data: T) => void] {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    load().then((d) => live && setData(d)).catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return [data, setData];
}

/** "Oct 31, 2026" / "31 Eki 2026". */
export function shortDate(date: string, lang: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (lang === "tr") return `${d} ${["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"][m - 1]} ${y}`;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}, ${y}`;
}

/** Shown while a form is being sent: a spinner and what is happening. */
export function FormStatus({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="form-status" aria-live="polite">
      <span className="spinner" aria-hidden="true"></span>
      <span>{message}</span>
    </div>
  );
}

/** A weight the way the old app showed it: always with a decimal ("92.0", "82.45"). */
export const kg = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n.toFixed(1) : String(value);
};
