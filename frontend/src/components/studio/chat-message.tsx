"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { parseMentions } from "@/lib/studio-tools/mentions";
import Tooltip from "@/components/ui/tooltip";
import styles from "./chat.module.css";

export const ChatTargets = createContext<{ references: { id: string; name: string }[]; emitters: { id: string; name: string }[]; onReference?: (id: string) => void; onPreview?: (id: string) => void; onEmitter?: (id: string) => void }>({ references: [], emitters: [] });
function Inline({ text }: { text: string }) {
  const targets = useContext(ChatTargets);
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, group) => {
    if (part.startsWith("**")) return <strong key={group}><Inline text={part.slice(2, -2)} /></strong>;
    if (part.startsWith("`")) return <code key={group}>{part.slice(1, -1)}</code>;
    return <span key={group}>{parseMentions(part, true).map((token, index) => {
      if (token.type === "text") return token.text;
      const item = (token.type === "reference" ? targets.references : targets.emitters).find(item => item.id === token.id);
      const capture = token.type === "reference" && !item && targets.onPreview;
      const click = token.type === "reference" ? (item ? targets.onReference : targets.onPreview) : targets.onEmitter;
      return <button key={index} type="button" className={styles.mentionChip} disabled={(!item && !capture) || !click} title={item ? `Focus ${item.name}` : capture ? "Open saved preview" : "This item is no longer available"} onClick={() => click?.(token.id)}>{token.type === "reference" ? "@" : "#"}{item?.name || token.label}{!item && !capture && " (unavailable)"}</button>;
    })}</span>;
  });
}
function inline(text: string): ReactNode { return <Inline text={text} />; }
function AssistantText({ text }: { text: string }) {
  return text.split(/(```[\s\S]*?(?:```|$))/g).map((block, i) => {
    if (block.startsWith("```")) return <pre key={i}><code>{block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")}</code></pre>;
    return block.split(/\n\s*\n/).filter(Boolean).map((paragraph, j) => {
      const lines = paragraph.split("\n");
      if (lines.every(line => /^\s*[-*] /.test(line))) return <ul key={`${i}-${j}`}>{lines.map((line, k) => <li key={k}>{inline(line.replace(/^\s*[-*] /, ""))}</li>)}</ul>;
      if (lines.every(line => /^\s*\d+\. /.test(line))) return <ol key={`${i}-${j}`}>{lines.map((line, k) => <li key={k}>{inline(line.replace(/^\s*\d+\. /, ""))}</li>)}</ol>;
      return <p key={`${i}-${j}`}>{inline(paragraph.replace(/^#{1,6} /gm, ""))}</p>;
    });
  });
}
export default function ChatMessage({ role, text, files = [], streaming = false, caption }: {
  role: "user" | "assistant"; text: string; files?: string[]; streaming?: boolean; caption?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return <article className={`${styles.message} ${role === "user" ? styles.user : styles.assistant}`} aria-label={role === "user" ? "Your message" : "Assistant message"}>
    <div className={styles.author}>{role === "user" ? "You" : <><span className={styles.mark} aria-hidden="true">✦</span> AutoV</>}</div>
    <div className={styles.body}>
      {files.length > 0 && <div className={styles.attachments}>{files.map((file, i) => <span key={i} title={file}>▧ {file}</span>)}</div>}
      {role === "assistant" ? <AssistantText text={text} /> : <p>{inline(text)}</p>}
    </div>
    {caption && <small className={styles.caption}>{caption}</small>}
    {role === "assistant" && text && !streaming && <Tooltip content={copyError ? "Could not copy · retry" : copied ? "Copied" : "Copy message"}><button type="button" className={styles.copy} aria-label={copyError ? "Could not copy. Retry copying message" : copied ? "Copied message" : "Copy assistant message"} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setCopyError(false); }
      catch { setCopyError(true); }
    }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{copyError ? <><path d="M12 8v5" /><circle cx="12" cy="17" r=".5" /><path d="m12 3 10 18H2Z" /></> : copied ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}</svg></button></Tooltip>}
  </article>;
}
