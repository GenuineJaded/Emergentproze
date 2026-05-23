/**
 * Minimal markdown rendering for Mercurius:
 *   - paragraphs separated by blank lines
 *   - blockquotes (lines beginning with `> `)
 *   - inline **bold**, *italic*, `code`
 *   - `---` horizontal rule
 *
 * Deliberately tiny — Mercurius's surface is contemplative, not feature-rich.
 */
import React from "react";

function renderInline(text) {
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push({ tag: "strong", inner: t.slice(2, -2) });
    else if (t.startsWith("*")) parts.push({ tag: "em", inner: t.slice(1, -1) });
    else if (t.startsWith("`")) parts.push({ tag: "code", inner: t.slice(1, -1) });
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, i) => {
    if (typeof p === "string") return <span key={i}>{p}</span>;
    if (p.tag === "strong") return <strong key={i}>{p.inner}</strong>;
    if (p.tag === "em") return <em key={i}>{p.inner}</em>;
    if (p.tag === "code") return <code key={i}>{p.inner}</code>;
    return null;
  });
}

export default function MarkdownLite({ text, showCursor = false }) {
  const blocks = (text || "").split(/\n\s*\n/);
  return (
    <>
      {blocks.map((blk, i) => {
        const trimmed = blk.trim();
        if (!trimmed && i < blocks.length - 1) return null;
        if (trimmed.startsWith(">")) {
          const inner = trimmed
            .split("\n")
            .map((l) => l.replace(/^>\s?/, ""))
            .join("\n");
          return (
            <blockquote key={i}>
              {inner.split("\n").map((line, j) => (
                <p key={j} style={{ margin: 0 }}>
                  {renderInline(line)}
                </p>
              ))}
            </blockquote>
          );
        }
        if (trimmed === "---" || trimmed === "***") {
          return <hr key={i} />;
        }
        const isLast = i === blocks.length - 1;
        return (
          <p key={i}>
            {trimmed.split("\n").map((line, j, arr) => (
              <span key={j}>
                {renderInline(line)}
                {j < arr.length - 1 && <br />}
              </span>
            ))}
            {showCursor && isLast && <span className="stream-caret" aria-hidden="true">▍</span>}
          </p>
        );
      })}
    </>
  );
}
