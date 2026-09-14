export type MentionToken =
  | { type: "text"; text: string }
  | { type: "reference" | "emitter"; id: string; label: string };
export function parseMentions(text: string, streaming = false): MentionToken[] {
  const pattern =
    /@\[([^\]\r\n]*)\]\(reference:([0-9a-f-]{36})\)|#\[([^\]\r\n]*)\]\(emitter:([^\s)]+)\)/gi;
  const tokens: MentionToken[] = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > start)
      tokens.push({ type: "text", text: text.slice(start, match.index) });
    try {
      tokens.push({
        type: match[1] !== undefined ? "reference" : "emitter",
        id: match[2] || decodeURIComponent(match[4]),
        label: match[1] ?? match[3],
      });
    } catch {
      tokens.push({ type: "text", text: match[0] });
    }
    start = match.index + match[0].length;
  }
  let tail = text.slice(start);
  if (streaming)
    tail = tail.replace(
      /([@#])\[([^\]\r\n]*)(?:\](?:\((?:reference|emitter)?(?::[^)]*)?)?)?$/,
      "$1$2",
    );
  if (tail) tokens.push({ type: "text", text: tail });
  return tokens;
}
