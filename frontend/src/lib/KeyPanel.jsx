import { useState, useEffect, useRef } from "react";
import { loadSettings, saveSettings, FREE_MODELS } from "./mercurius_settings";

/**
 * Compact settings panel for BYOK + model selection.
 *
 * Render it as a floating overlay; pass `open` and `onClose`. The trigger
 * (a small "key" link or icon) lives in the parent page.
 */
export default function KeyPanel({ open, onClose }) {
  const [settings, setSettings] = useState(() => loadSettings());
  const [reveal, setReveal] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSettings(loadSettings());
    setReveal(false);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onDoc = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, onClose]);

  if (!open) return null;

  const update = (patch) => {
    const next = saveSettings(patch);
    setSettings(next);
  };

  const masked = settings.openrouter_key
    ? settings.openrouter_key.slice(0, 8) + "…" + settings.openrouter_key.slice(-4)
    : "";

  return (
    <div
      ref={panelRef}
      data-testid="key-panel"
      className="absolute"
      style={{
        top: 70,
        right: 24,
        width: 380,
        background: "rgba(13,17,23,0.96)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(200,162,107,0.28)",
        borderRadius: 6,
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        color: "var(--ink-text)",
        zIndex: 60,
        padding: "18px 20px",
      }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <div
          className="font-serif italic"
          style={{ color: "var(--ink-text)", fontSize: 17 }}
        >
          your key
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-ui transition-colors duration-200"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ink-text-faint)",
            cursor: "pointer",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-text-faint)")}
        >
          esc
        </button>
      </div>
      <div
        className="font-serif italic"
        style={{ color: "var(--ink-text-faint)", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}
      >
        leave blank to use the shared free tier. paste your own to bypass it.{" "}
        <a
          href="https://openrouter.ai/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--ink-accent)", textDecoration: "underline" }}
        >
          get one
        </a>
        .
      </div>

      <label
        className="font-ui block"
        style={{
          color: "var(--ink-text-dim)",
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        openrouter key
      </label>
      <div style={{ position: "relative", marginBottom: 14 }}>
        <input
          type={reveal ? "text" : "password"}
          data-testid="key-panel-input"
          value={settings.openrouter_key}
          onChange={(e) => update({ openrouter_key: e.target.value })}
          placeholder="sk-or-v1-…"
          autoComplete="off"
          spellCheck={false}
          className="font-ui w-full"
          style={{
            background: "var(--ink-bg-2)",
            color: "var(--ink-text)",
            border: "1px solid var(--ink-rule)",
            borderRadius: 3,
            padding: "8px 56px 8px 10px",
            fontSize: 13,
            outline: "none",
            fontFamily: "Inter Tight, monospace",
          }}
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          className="font-ui"
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            color: "var(--ink-text-faint)",
            cursor: "pointer",
            fontSize: 9,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            padding: "4px 6px",
          }}
        >
          {reveal ? "hide" : "show"}
        </button>
      </div>

      <label
        className="font-ui block"
        style={{
          color: "var(--ink-text-dim)",
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        model
      </label>
      <select
        data-testid="key-panel-model"
        value={settings.model}
        onChange={(e) => update({ model: e.target.value })}
        className="font-ui w-full"
        style={{
          background: "var(--ink-bg-2)",
          color: "var(--ink-text)",
          border: "1px solid var(--ink-rule)",
          borderRadius: 3,
          padding: "8px 10px",
          fontSize: 13,
          outline: "none",
          marginBottom: 14,
        }}
      >
        {FREE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>

      <div
        className="font-ui"
        style={{
          color: "var(--ink-text-faint)",
          fontSize: 10,
          letterSpacing: "0.06em",
          lineHeight: 1.55,
        }}
      >
        {settings.openrouter_key ? (
          <>using your key · {masked}</>
        ) : (
          <>using the shared free tier · subject to small daily limit</>
        )}
      </div>
    </div>
  );
}
