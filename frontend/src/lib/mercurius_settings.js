/**
 * Visitor-owned settings: their OpenRouter key + preferred model.
 *
 * If no key is set here, the backend falls back to its env var
 * (OPENROUTER_API_KEY) — the admin's shared free-tier default. Visitors who
 * paste their own key bypass the shared quota.
 */

const KEY = "mercurius_settings_v1";

const DEFAULTS = {
  openrouter_key: "",
  model: "", // empty → backend uses its own default
};

// Curated set of OpenRouter `:free` models known to be decent at literary /
// contemplative prose. Order is rough preference. List drifts over time —
// edit here when models come and go.
export const FREE_MODELS = [
  { id: "", label: "default (shared free tier)" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
  { id: "deepseek/deepseek-chat-v3.1:free", label: "DeepSeek v3.1 (free)" },
  { id: "qwen/qwen-2.5-72b-instruct:free", label: "Qwen 2.5 72B (free)" },
  { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free)" },
  { id: "mistralai/mistral-small-3.2-24b-instruct:free", label: "Mistral Small 3.2 (free)" },
];

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch (_) {
    return fallback;
  }
}

export function loadSettings() {
  return safeParse(localStorage.getItem(KEY), DEFAULTS);
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearSettings() {
  localStorage.removeItem(KEY);
}

export function hasOwnKey() {
  return !!loadSettings().openrouter_key.trim();
}
