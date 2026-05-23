/**
 * Stream a Mercurius reply over Server-Sent Events.
 *
 * Posts to /api/mercurius/chat/stream and parses the `data: {...}` event
 * frames, invoking the provided callbacks. Returns a Promise that resolves
 * with the final conversation_id + full assistant text, or rejects on error.
 *
 * Event types from the backend:
 *  - { type: "meta", conversation_id, user_message_id, assistant_message_id, passages }
 *  - { type: "token", content }
 *  - { type: "done", content }
 *  - { type: "error", message }
 */
export async function streamMercuriusChat({
  apiBase,
  conversationId = null,
  message,
  cameraContext = null,
  useLatestConversation = false,
  onMeta = () => {},
  onToken = () => {},
  onDone = () => {},
  signal = null,
}) {
  const res = await fetch(`${apiBase}/mercurius/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: conversationId,
      message,
      camera_context: cameraContext,
      use_latest_conversation: useLatestConversation,
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
  let resolvedConvId = conversationId;
  let assistantMsgId = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines.
    const frames = buf.split("\n\n");
    buf = frames.pop(); // keep partial last frame
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch (e) {
        // skip malformed
        continue;
      }
      if (evt.type === "meta") {
        resolvedConvId = evt.conversation_id;
        assistantMsgId = evt.assistant_message_id;
        onMeta(evt);
      } else if (evt.type === "token") {
        fullText += evt.content || "";
        onToken(evt.content || "", fullText);
      } else if (evt.type === "done") {
        fullText = evt.content || fullText;
        onDone({ conversationId: resolvedConvId, assistantMessageId: assistantMsgId, content: fullText });
        return { conversationId: resolvedConvId, assistantMessageId: assistantMsgId, content: fullText };
      } else if (evt.type === "error") {
        throw new Error(evt.message || "stream error");
      }
    }
  }
  // If we exited the loop without a `done`, treat as connection drop
  throw Object.assign(new Error("connection dropped mid-stream"), {
    partial: fullText,
    conversationId: resolvedConvId,
    assistantMessageId: assistantMsgId,
  });
}
