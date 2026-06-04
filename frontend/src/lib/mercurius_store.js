/**
 * localStorage-backed thread store for Mercurius.
 *
 * No server-side persistence — threads live in the browser. Each thread is a
 * { id, title, updated_at } record in THREADS_KEY; messages for each thread
 * are stored under MESSAGES_PREFIX + threadId so we don't rewrite a giant
 * blob on every append.
 */

const THREADS_KEY = "mercurius_threads_v1";
const MESSAGES_PREFIX = "mercurius_msgs_v1_";
const CURRENT_KEY = "mercurius_current_conv_id";

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function listThreads() {
  const arr = safeParse(localStorage.getItem(THREADS_KEY), []);
  arr.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return arr;
}

export function getCurrentThreadId() {
  return localStorage.getItem(CURRENT_KEY) || null;
}

export function setCurrentThreadId(id) {
  if (id) localStorage.setItem(CURRENT_KEY, id);
  else localStorage.removeItem(CURRENT_KEY);
}

export function createThread(title) {
  const t = {
    id: uuid(),
    title: (title || "").trim().slice(0, 60) || "New thread",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const arr = listThreads();
  arr.unshift(t);
  localStorage.setItem(THREADS_KEY, JSON.stringify(arr));
  return t;
}

export function renameThread(id, title) {
  const arr = listThreads();
  const t = arr.find((x) => x.id === id);
  if (!t) return;
  t.title = (title || "").trim().slice(0, 60) || t.title;
  localStorage.setItem(THREADS_KEY, JSON.stringify(arr));
}

export function touchThread(id) {
  const arr = listThreads();
  const t = arr.find((x) => x.id === id);
  if (!t) return;
  t.updated_at = new Date().toISOString();
  localStorage.setItem(THREADS_KEY, JSON.stringify(arr));
}

export function deleteThread(id) {
  const arr = listThreads().filter((t) => t.id !== id);
  localStorage.setItem(THREADS_KEY, JSON.stringify(arr));
  localStorage.removeItem(MESSAGES_PREFIX + id);
  if (getCurrentThreadId() === id) setCurrentThreadId(null);
}

export function loadMessages(threadId) {
  if (!threadId) return [];
  return safeParse(localStorage.getItem(MESSAGES_PREFIX + threadId), []);
}

export function saveMessages(threadId, messages) {
  if (!threadId) return;
  localStorage.setItem(MESSAGES_PREFIX + threadId, JSON.stringify(messages));
}

export function appendMessage(threadId, message) {
  const msgs = loadMessages(threadId);
  msgs.push(message);
  saveMessages(threadId, msgs);
  touchThread(threadId);
  return msgs;
}

export function makeMessageId(role) {
  return `${role[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
