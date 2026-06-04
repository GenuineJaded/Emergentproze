/**
 * Stream a Mercurius reply over Server-Sent Events.
 *
 * Posts to /api/mercurius/chat/stream with the user's message, conversation
 * history (the client owns thread state in localStorage), and optional
 * camera context. Parses the `data: {...}` event frames and invokes the
 * provided callbacks.
 *
 * Event types from the backend:
 *  - { type: "meta", passages }
 *  - { type: "token", content }
 *  - { type: "done", content }
 *  - { type: "error", message }
 */
export async function streamMercuriusChat({
  apiBase,
  message,
  history = [],
  cameraContext = null,
  onMeta = () => {},
  onToken = () => {},
  onDone = () => {},
  signal = null,
}) {
  const res = await fetch(`${apiBase}/mercurius/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      camera_context: cameraContext,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = await res.text();
    } catch (_) {}
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const frames = buf.split("\n\n");
    buf = frames.pop();
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch (_) {
        continue;
      }
      if (evt.type === "meta") {
        onMeta(evt);
      } else if (evt.type === "token") {
        fullText += evt.content || "";
        onToken(evt.content || "", fullText);
      } else if (evt.type === "done") {
        fullText = evt.content || fullText;
        onDone({ content: fullText });
        return { content: fullText };
      } else if (evt.type === "error") {
        throw new Error(evt.message || "stream error");
      }
    }
  }
  throw Object.assign(new Error("connection dropped mid-stream"), {
    partial: fullText,
  });
}
