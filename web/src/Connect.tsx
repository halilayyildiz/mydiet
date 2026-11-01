// How to log days from an AI chat app through MyDiet's MCP connector, with the user's own link.
import { useEffect, useState } from "react";
import { api, type ConnectUrls } from "./api.ts";
import { useApp } from "./App.tsx";

export function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      window.prompt("", value);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <label className="copy-field">
      {label}
      <span className="copy-row">
        <input value={value} readOnly onFocus={(e) => e.target.select()} />
        <button type="button" onClick={copy}>{copied ? `✓ ${t.copied}` : t.copy}</button>
      </span>
    </label>
  );
}

export function ConnectPanel({ showWeight = false }: { showWeight?: boolean }) {
  const { t, session, errorText, flash } = useApp();
  const [urls, setUrls] = useState<ConnectUrls | null>(null);

  useEffect(() => {
    if (session.demo || !session.authenticated) return;
    api.connect().then(setUrls).catch((err) => flash("error", errorText(err)));
  }, [session.demo, session.authenticated]);

  const rotate = async () => {
    if (!window.confirm(t.new_link_confirm)) return;
    try {
      setUrls(await api.rotateConnect());
    } catch (err) {
      flash("error", errorText(err));
    }
  };

  return (
    <section className="connect-panel" id="connect">
      <h2>{t.connect_title}</h2>
      <p className="muted">{t.connect_intro}</p>
      <ol className="connect-steps">
        <li>{t.connect_step1}</li>
        <li>{t.connect_step2}</li>
        <li>{t.connect_step3}</li>
      </ol>
      {session.demo ? (
        <p><a href="/demo/exit?next=register">{t.connect_demo}</a></p>
      ) : (
        urls && (
          <>
            <CopyField label={t.connect_link} value={urls.mcpUrl} />
            {showWeight && <CopyField label={t.connect_weight} value={urls.weightUrl} />}
            <p className="muted small">{t.connect_secret}</p>
            {showWeight && <button type="button" className="link-button" onClick={rotate}>{t.new_link}</button>}
          </>
        )
      )}
    </section>
  );
}
