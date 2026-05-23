import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import MarkdownLite from "../lib/MarkdownLite";
import { streamMercuriusChat } from "../lib/mercurius_stream";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const LS_KEY = "mercurius_current_conv_id";

const STARTERS = [
  "What is this?",
  "How do I move around?",
  "Where should I look first?",
  "Show me something strange.",
  "What am I missing?",
  "Speak to me as if I have already understood.",
];

const WELCOME = `*Mercurius listens.*

You are the observer-node. I am a mirror — sometimes faithful, sometimes turned at an angle so the room can see what the room could not see directly. The sketch is around us, not above us. We move within it together.

Ask me anything. Or pick one of the openings below.`;

function StarterDropdown({ onPick, disabled }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        data-testid="starter-prompts-button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="font-ui text-xs uppercase tracking-[0.18em] transition-colors duration-300"
        style={{
          color: "var(--ink-text-faint)",
          padding: "8px 12px",
          background: "transparent",
          border: `1px solid var(--ink-rule)`,
          borderRadius: 3,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
        }}
        onMouseEnter={(e) => !disabled && (e.currentTarget.style.color = "var(--ink-text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-text-faint)")}
      >
        Openings {open ? "↑" : "↓"}
      </button>
      {open && (
        <div
          data-testid="starter-prompts-dropdown"
          className="absolute bottom-full mb-2 left-0 w-80 z-20"
          style={{
            background: "rgba(13,17,23,0.96)",
            backdropFilter: "blur(14px)",
            border: "1px solid var(--ink-rule)",
            borderRadius: 4,
            padding: "6px 0",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}
        >
          {STARTERS.map((s, i) => (
            <button
              key={i}
              type="button"
              data-testid={`starter-prompt-${i}`}
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
              className="block w-full text-left font-serif italic transition-colors duration-200"
              style={{
                color: "var(--ink-text)",
                fontSize: 15,
                padding: "9px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(200,162,107,0.08)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationItem({ conv, active, onClick, onDelete }) {
  return (
    <div
      className="group relative flex items-center"
      style={{ borderLeft: active ? `2px solid var(--ink-accent)` : "2px solid transparent" }}
    >
      <button
        type="button"
        data-testid={`conversation-item-${conv.id}`}
        onClick={onClick}
        className="font-serif italic text-left w-full transition-colors duration-200"
        style={{
          color: active ? "var(--ink-text)" : "var(--ink-text-dim)",
          fontSize: 14,
          padding: "8px 14px 8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-text)")}
        onMouseLeave={(e) => !active && (e.currentTarget.style.color = "var(--ink-text-dim)")}
      >
        {conv.title || "Untitled"}
      </button>
      <button
        type="button"
        data-testid={`delete-conversation-${conv.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 font-ui text-xs px-3"
        style={{ color: "var(--ink-text-faint)", background: "transparent", border: "none", cursor: "pointer" }}
        title="forget this thread"
      >
        ✕
      </button>
    </div>
  );
}

export default function Mercurius() {
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);  // request in flight
  const [waitingFirstToken, setWaitingFirstToken] = useState(false); // before first token arrives
  const [error, setError] = useState("");
  const [retryPayload, setRetryPayload] = useState(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/mercurius/conversations`);
      setConversations(r.data);
    } catch (e) {
      console.error("loadConversations", e);
    }
  }, []);

  const loadMessages = useCallback(async (convId) => {
    if (!convId) {
      setMessages([]);
      return;
    }
    try {
      const r = await axios.get(`${API}/mercurius/conversations/${convId}/messages`);
      setMessages(r.data);
    } catch (e) {
      console.error("loadMessages", e);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (currentId) loadMessages(currentId);
  }, [currentId, loadMessages]);

  // Persist active conversation id so the m-shortcut on /geometry can find it.
  useEffect(() => {
    if (currentId) localStorage.setItem(LS_KEY, currentId);
  }, [currentId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, waitingFirstToken]);

  const sendMessage = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setSending(true);
    setWaitingFirstToken(true);
    setError("");
    setRetryPayload(null);

    const tmpUserId = `tmp-u-${Date.now()}`;
    const tmpAsstId = `tmp-a-${Date.now()}`;
    const optimisticUser = {
      id: tmpUserId,
      role: "user",
      content: msg,
      conversation_id: currentId || "tmp",
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);
    setInput("");

    let assistantInserted = false;
    let resolvedConvId = currentId;

    try {
      const result = await streamMercuriusChat({
        apiBase: API,
        conversationId: currentId,
        message: msg,
        onMeta: (meta) => {
          resolvedConvId = meta.conversation_id;
          // Insert the empty assistant message slot
          setMessages((m) => [
            ...m,
            {
              id: meta.assistant_message_id || tmpAsstId,
              role: "assistant",
              content: "",
              conversation_id: meta.conversation_id,
              created_at: new Date().toISOString(),
              _streaming: true,
            },
          ]);
          assistantInserted = true;
        },
        onToken: (_token, full) => {
          if (waitingFirstToken) setWaitingFirstToken(false);
          setWaitingFirstToken(false);
          setMessages((m) =>
            m.map((x) => (x._streaming ? { ...x, content: full } : x))
          );
        },
        onDone: ({ content }) => {
          setMessages((m) =>
            m.map((x) => (x._streaming ? { ...x, content, _streaming: false } : x))
          );
        },
      });

      if (result.conversationId && result.conversationId !== currentId) {
        setCurrentId(result.conversationId);
      }
      loadConversations();
    } catch (e) {
      console.error("stream", e);
      const detail = e?.message || "the line went quiet";
      setError(String(detail));
      // If the connection dropped mid-stream, keep the partial assistant text
      // but mark _streaming false and surface a retry affordance.
      if (assistantInserted) {
        setMessages((m) =>
          m.map((x) => (x._streaming ? { ...x, _streaming: false } : x))
        );
      } else {
        // Nothing arrived — remove the optimistic user, restore input
        setMessages((m) => m.filter((x) => x.id !== tmpUserId));
        setInput(msg);
      }
      setRetryPayload({ message: msg, conversationId: resolvedConvId || currentId });
    } finally {
      setSending(false);
      setWaitingFirstToken(false);
      textareaRef.current?.focus();
    }
  };

  const retryLast = async () => {
    if (!retryPayload || sending) return;
    setError("");
    const { message: msg } = retryPayload;
    setRetryPayload(null);
    await sendMessage(msg);
  };

  const newConversation = () => {
    setCurrentId(null);
    setMessages([]);
    setError("");
    setRetryPayload(null);
    localStorage.removeItem(LS_KEY);
    textareaRef.current?.focus();
  };

  const deleteConversation = async (id) => {
    try {
      await axios.delete(`${API}/mercurius/conversations/${id}`);
      if (currentId === id) {
        setCurrentId(null);
        setMessages([]);
        localStorage.removeItem(LS_KEY);
      }
      setConversations((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      console.error("delete", e);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div
      className="flex w-screen h-screen"
      style={{ background: "var(--ink-bg)", color: "var(--ink-text)" }}
      data-testid="mercurius-page"
    >
      {/* Sidebar */}
      <aside
        className="flex flex-col"
        style={{
          width: 240,
          background: "var(--ink-bg-2)",
          borderRight: "1px solid var(--ink-rule-soft)",
        }}
      >
        <div className="px-4 py-5">
          <Link
            to="/"
            data-testid="mercurius-home-link"
            className="font-ui text-xs uppercase tracking-[0.18em] transition-colors duration-300"
            style={{ color: "var(--ink-text-faint)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-text-faint)")}
          >
            ← Home
          </Link>
          <div
            className="font-wordmark text-2xl mt-3"
            style={{ color: "var(--ink-text)" }}
          >
            mercurius
          </div>
          <div
            className="font-serif italic text-xs mt-1"
            style={{ color: "var(--ink-text-faint)" }}
          >
            the companion
          </div>
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            data-testid="new-conversation-btn"
            onClick={newConversation}
            className="font-ui text-xs uppercase tracking-[0.18em] w-full text-left transition-colors duration-200"
            style={{
              padding: "8px 10px",
              background: "transparent",
              color: "var(--ink-text-dim)",
              border: "1px dashed var(--ink-rule)",
              borderRadius: 3,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--ink-text)";
              e.currentTarget.style.borderColor = "var(--ink-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--ink-text-dim)";
              e.currentTarget.style.borderColor = "var(--ink-rule)";
            }}
          >
            + new thread
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-1"
          data-testid="conversation-list"
        >
          {conversations.length === 0 && (
            <div
              className="font-serif italic text-sm px-4 py-3"
              style={{ color: "var(--ink-text-faint)" }}
            >
              no threads yet.
            </div>
          )}
          {conversations.map((c) => (
            <ConversationItem
              key={c.id}
              conv={c}
              active={c.id === currentId}
              onClick={() => setCurrentId(c.id)}
              onDelete={() => deleteConversation(c.id)}
            />
          ))}
        </div>

        <div
          className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.18em]"
          style={{
            color: "var(--ink-text-faint)",
            borderTop: "1px solid var(--ink-rule-soft)",
          }}
        >
          Phase 0 · POC
        </div>
      </aside>

      {/* Main chat */}
      <main className="flex-1 flex flex-col min-w-0">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          data-testid="messages-scroll"
        >
          <div className="max-w-2xl mx-auto px-8 py-10">
            {!hasMessages && (
              <div className="mercurius-prose" data-testid="welcome-message">
                <MarkdownLite text={WELCOME} />
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={m.id || i}
                className="mt-6"
                data-testid={`message-${m.role}-${i}`}
              >
                {m.role === "user" ? (
                  <div className="user-prose flex">
                    <div
                      className="opacity-60 mr-3 font-ui text-[10px] uppercase tracking-[0.18em] pt-1"
                      style={{ color: "var(--ink-text-faint)", minWidth: 18 }}
                    >
                      you
                    </div>
                    <div style={{ color: "var(--ink-text)" }}>{m.content}</div>
                  </div>
                ) : (
                  <div className="mercurius-prose flex">
                    <div
                      className="mr-3 font-ui text-[10px] uppercase tracking-[0.18em] pt-1"
                      style={{ color: "var(--ink-accent)", minWidth: 18 }}
                    >
                      m.
                    </div>
                    <div className="flex-1">
                      <MarkdownLite text={m.content} showCursor={!!m._streaming} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {waitingFirstToken && (
              <div className="mt-6 flex items-center gap-3" data-testid="thinking-indicator">
                <span
                  className="font-ui text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--ink-accent)" }}
                >
                  m.
                </span>
                <span
                  className="breath-dot inline-block rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    background: "var(--ink-accent)",
                  }}
                />
                <span
                  className="font-serif italic text-sm"
                  style={{ color: "var(--ink-text-faint)" }}
                >
                  listening
                </span>
              </div>
            )}

            {error && (
              <div
                className="mt-4 font-serif italic text-sm flex items-center gap-3"
                style={{ color: "#c97a7a" }}
                data-testid="chat-error"
              >
                <span>— {error}</span>
                {retryPayload && (
                  <button
                    type="button"
                    data-testid="chat-retry"
                    onClick={retryLast}
                    className="font-ui text-[10px] uppercase tracking-[0.18em] underline"
                    style={{ background: "transparent", border: "none", color: "var(--ink-accent)", cursor: "pointer" }}
                  >
                    retry
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Input bar */}
        <div
          className="px-8 py-5"
          style={{ borderTop: "1px solid var(--ink-rule-soft)", background: "var(--ink-bg)" }}
        >
          <div className="max-w-2xl mx-auto">
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  data-testid="chat-input"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="speak"
                  disabled={sending}
                  className="font-serif w-full resize-none"
                  style={{
                    background: "var(--ink-bg-2)",
                    color: "var(--ink-text)",
                    border: "1px solid var(--ink-rule)",
                    borderRadius: 4,
                    padding: "12px 14px",
                    fontSize: 17,
                    lineHeight: 1.5,
                    outline: "none",
                    minHeight: 48,
                    maxHeight: 200,
                  }}
                  onInput={(e) => {
                    e.currentTarget.style.height = "auto";
                    e.currentTarget.style.height =
                      Math.min(e.currentTarget.scrollHeight, 200) + "px";
                  }}
                />
              </div>
              <button
                type="button"
                data-testid="send-button"
                onClick={() => sendMessage()}
                disabled={sending || !input.trim()}
                className="font-ui text-xs uppercase tracking-[0.18em] transition-colors duration-200"
                style={{
                  padding: "12px 18px",
                  background: input.trim() && !sending ? "var(--ink-accent)" : "transparent",
                  color: input.trim() && !sending ? "var(--ink-bg)" : "var(--ink-text-faint)",
                  border: `1px solid ${input.trim() && !sending ? "var(--ink-accent)" : "var(--ink-rule)"}`,
                  borderRadius: 3,
                  cursor: sending || !input.trim() ? "default" : "pointer",
                  opacity: sending ? 0.5 : 1,
                }}
              >
                send
              </button>
            </div>
            <div className="mt-3 flex justify-between items-center">
              <StarterDropdown
                onPick={(s) => {
                  setInput(s);
                  sendMessage(s);
                }}
                disabled={sending}
              />
              <span
                className="font-ui text-[10px] uppercase tracking-[0.18em]"
                style={{ color: "var(--ink-text-faint)" }}
              >
                claude sonnet 4.5 · grounded in corpus · streaming
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
