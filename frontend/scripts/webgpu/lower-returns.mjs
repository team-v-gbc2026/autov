/** TSL inline Fn graphs do not support early returns. Keep a single return for
 * uniform-dependent helpers, with explicit branches matching the GLSL contract.
 * Pure functions can retain native WGSL function layouts.
 */
export function lowerReturns(source) {
  return source;
}

// ---------------------------------------------------------------------------
// General single-exit lowering
// ---------------------------------------------------------------------------
// The authored V2 shaders guard their variants with early returns:
//
//   void main(){ A; if(uPlane==1){ X; return; } B; if(uSlab==1){ Y; return; } C; }
//
// TSL inline Fn graphs have no early exit, so every guard becomes the `if` half
// of an if/else and everything after it becomes the `else` half. A function that
// returns a value gets one result variable and a single trailing return. This is
// a mechanical rewrite of control flow only; no expression is touched.

const TYPES = "void|bool|int|float|vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4";

/** Index of the first character that is neither whitespace nor a comment. */
function skipTrivia(source, i) {
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end + 1;
    } else if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i);
      i = end < 0 ? source.length : end + 2;
    } else return i;
  }
}

/** Index just past the bracket that `source[open]` opens. */
function matchBracket(source, open) {
  const close = { "(": ")", "{": "}", "[": "]" }[source[open]];
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source[i] === source[open]) depth++;
    else if (source[i] === close && --depth === 0) return i + 1;
  }
  throw new Error("Unbalanced bracket in shader source: " + JSON.stringify(source.slice(open, open + 160)));
}

/** Split one block body into its top-level statements, comments included. */
function statements(body, glue = true) {
  const out = [];
  let start = 0,
    i = 0,
    paren = 0,
    brace = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "/" && (body[i + 1] === "/" || body[i + 1] === "*")) {
      i = skipTrivia(body, i);
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "{") brace++;
    else if (c === "}") {
      brace--;
      if (!brace && !paren) {
        const next = skipTrivia(body, i + 1);
        // `} else` and `} while` continue the same statement.
        if (glue && /^(else|while)\b/.test(body.slice(next))) {
          i = next;
          continue;
        }
        out.push(body.slice(start, i + 1));
        start = i + 1;
      }
    } else if (c === ";" && !brace && !paren) {
      const next = skipTrivia(body, i + 1);
      // A braceless `if (c) x; else y;` is one statement, not two.
      if (glue && /^(else|while)\b/.test(body.slice(next))) {
        i = next;
        continue;
      }
      out.push(body.slice(start, i + 1));
      start = i + 1;
    }
    i++;
  }
  if (body.slice(start).trim()) out.push(body.slice(start));
  return out;
}

/** `if (cond) { ... }` with no `else`, or null. */
function guardOf(statement) {
  const head = skipTrivia(statement, 0);
  if (!/^if\s*\(/.test(statement.slice(head))) return null;
  const open = statement.indexOf("(", head);
  const afterCond = matchBracket(statement, open);
  const body = skipTrivia(statement, afterCond);
  // A braceless consequent is one statement. An `else` on the same statement
  // belongs to the caller's chain, not to this guard.
  if (statement[body] !== "{") {
    const [only] = statements(statement.slice(body), false);
    if (statement.slice(body + (only?.length ?? 0)).trim()) return null;
    return {
      lead: statement.slice(0, head),
      condition: statement.slice(open, afterCond),
      body: statement.slice(body),
    };
  }
  const afterBody = matchBracket(statement, body);
  if (statement.slice(afterBody).trim()) return null;
  return {
    lead: statement.slice(0, head),
    condition: statement.slice(open, afterCond),
    body: statement.slice(body + 1, afterBody - 1),
  };
}

const RETURN = /^return\b\s*([\s\S]*?)\s*;$/;

/** `for (...) { ... }` / `while (...) { ... }`, or null. */
function loopOf(statement) {
  const head = skipTrivia(statement, 0);
  if (!/^(for|while)\s*\(/.test(statement.slice(head))) return null;
  const open = statement.indexOf("(", head);
  const afterHeader = matchBracket(statement, open);
  const body = skipTrivia(statement, afterHeader);
  if (statement[body] !== "{") return null;
  const afterBody = matchBracket(statement, body);
  if (statement.slice(afterBody).trim()) return null;
  return {
    prefix: statement.slice(0, body + 1),
    body: statement.slice(body + 1, afterBody - 1),
    suffix: statement.slice(afterBody - 1),
  };
}

/** Does this text contain a `return` at any depth, comments aside? */
function hasReturn(text) {
  const mask = commentMask(text);
  for (const match of text.matchAll(/\breturn\b/g))
    if (!mask[match.index]) return true;
  return false;
}

/** Turn every `return` inside a loop body into "record the answer and stop". */
function lowerLoopReturns(body, assign) {
  return statements(body)
    .map((statement) => {
      const returned = returnOf(statement);
      if (returned)
        return `${returned.lead}${assign(returned.value)}portDone=true;break;`;
      const guard = guardOf(statement);
      if (guard && hasReturn(guard.body))
        return `${guard.lead}if${guard.condition}{${lowerLoopReturns(guard.body, assign)}}`;
      return statement;
    })
    .join("");
}

function returnOf(statement) {
  const head = skipTrivia(statement, 0);
  const match = RETURN.exec(statement.slice(head).trim());
  return match ? { lead: statement.slice(0, head), value: match[1] } : null;
}

/** Rewrite one block so control always falls out of its bottom. */
function lowerBlock(body, assign) {
  const list = statements(body);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const statement = list[i];
    const returned = returnOf(statement);
    if (returned) {
      // Everything after an unconditional return is unreachable.
      out.push(returned.lead + assign(returned.value));
      return out.join("");
    }
    const guard = guardOf(statement);
    const inner = guard && statements(guard.body);
    if (guard && inner.length && returnOf(inner[inner.length - 1])) {
      const rest = lowerBlock(list.slice(i + 1).join(""), assign);
      // A chain of guards stays a chain: `else if` transpiles to one flat
      // ElseIf sequence, where `else { if ... }` nests a closure per guard and
      // makes an inlined helper's node graph grow with the square of its
      // branches.
      const chained = /^if\s*\(/.test(rest.slice(skipTrivia(rest, 0)));
      out.push(
        `${guard.lead}if${guard.condition}{${lowerBlock(guard.body, assign)}\n} else ` +
          (chained ? `${rest}\n` : `{\n${rest}\n}\n`),
      );
      return out.join("");
    }
    // A loop that returns keeps its answer in the result variable and stops;
    // whatever followed it only runs when the loop fell through.
    const loop = loopOf(statement);
    if (loop && hasReturn(loop.body)) {
      const rest = list.slice(i + 1).join("");
      out.push(
        `${loop.prefix}${lowerLoopReturns(loop.body, assign)}${loop.suffix}\nif(portDone==false){\n${lowerBlock(rest, assign)}\n}\n`,
      );
      return out.join("");
    }
    out.push(statement);
  }
  return out.join("");
}

/** Per-character flags marking everything inside a comment. */
function commentMask(source) {
  const mask = new Uint8Array(source.length);
  for (let i = 0; i < source.length; ) {
    const next = skipTrivia(source, i);
    if (next > i) {
      for (let j = i; j < next; j++) mask[j] = 1;
      i = next;
    } else i++;
  }
  return mask;
}

/** Wrap a braceless `for` / `while` body in braces: the GLSL transpiler only
 * accepts a block there, so `for (...) for (...) { }` does not parse.
 *
 * `if` / `else` are deliberately left alone. The transpiler reads them, and an
 * `else if` chain has to stay a chain — rewriting it as nested blocks turns a
 * flat ElseIf sequence into deeply nested TSL closures. */
export function braceBodies(source) {
  // `else if` chains nest, so one pass can only brace the outermost body of
  // each chain without its edits overlapping. Repeat until nothing is left.
  for (let pass = 0; pass < 32; pass++) {
    const next = bracePass(source);
    if (next === source) return source;
    source = next;
  }
  throw new Error("Braceless statement nesting did not settle");
}

function bracePass(source) {
  const commented = commentMask(source);
  const keyword = /\b(for|while)\b/g;
  const edits = [];
  for (let match; (match = keyword.exec(source)); ) {
    // These words occur in the authored comments too.
    if (commented[match.index]) continue;
    const open = skipTrivia(source, keyword.lastIndex);
    if (source[open] !== "(") continue;
    const body = skipTrivia(source, matchBracket(source, open));
    if (source[body] === "{") continue;
    const rest = source.slice(body);
    // A trailing `else` belongs to the outer `if` unless the body is itself an
    // `if`, where GLSL binds it to the inner one.
    let [first] = statements(rest, false);
    if (first && /^if\b/.test(rest.slice(skipTrivia(rest, 0))))
      [first] = statements(rest, true);
    if (!first) continue;
    edits.push({ start: body, end: body + first.length, text: first });
  }
  // Back to front, so the offsets of earlier edits stay valid. Nested edits are
  // dropped and picked up by the next pass.
  let limit = source.length;
  for (const edit of edits.reverse()) {
    if (edit.end > limit) continue;
    limit = edit.start;
    source =
      source.slice(0, edit.start) + `{${edit.text}}` + source.slice(edit.end);
  }
  return source;
}

/** WGSL function parameters are immutable, so a helper that rewrites its own
 * argument cannot become a real function. Give each such parameter a local copy
 * with the original name; the body is then unchanged. */
export function copyMutatedParameters(source) {
  const header = new RegExp(`\\b(${TYPES})\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, "g");
  const edits = [];
  for (let match; (match = header.exec(source)); ) {
    const open = header.lastIndex - 1;
    const end = matchBracket(source, open);
    header.lastIndex = end;
    if (match[2] === "main" || /\bout\s+\w/.test(match[3])) continue;
    const body = source.slice(open + 1, end - 1);
    const copies = [];
    let params = match[3];
    for (const parameter of match[3].split(",")) {
      const parsed = parameter.trim().match(/^(\w+)\s+(\w+)$/);
      if (!parsed) continue;
      const [, type, name] = parsed;
      const written = new RegExp(
        `\\b${name}\\b(?:\\.\\w+)?\\s*(?:[-+*/]?=[^=]|\\+\\+|--)`,
      );
      if (!written.test(body)) continue;
      params = params.replace(
        new RegExp(`\\b${type}\\s+${name}\\b`),
        `${type} ${name}_arg`,
      );
      copies.push(`${type} ${name}=${name}_arg;`);
    }
    if (!copies.length) continue;
    edits.push({
      start: match.index,
      end: open + 1,
      text: `${match[1]} ${match[2]}(${params}){${copies.join("")}`,
    });
  }
  for (const edit of edits.reverse())
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

/** Give every function in `source` a single exit at the bottom of its body.
 *
 * `skip` names the helpers that keep a real WGSL function of their own, where
 * `return` is legal. Rewriting those into single-exit form would turn a flat
 * chain of guards into deeply nested TSL branches for no reason. */
export function lowerEarlyReturns(source, skip = new Set()) {
  const header = new RegExp(`\\b(${TYPES})\\s+(\\w+)\\s*\\(`, "g");
  const found = [];
  for (let match; (match = header.exec(source)); ) {
    const afterParams = matchBracket(source, header.lastIndex - 1);
    const open = skipTrivia(source, afterParams);
    if (source[open] !== "{") continue;
    const end = matchBracket(source, open);
    if (!skip.has(match[2]))
      found.push({ type: match[1], start: open + 1, end: end - 1 });
    header.lastIndex = end;
  }
  // Rewrite back to front so earlier offsets stay valid.
  for (const fn of found.reverse()) {
    const body = source.slice(fn.start, fn.end);
    const list = statements(body);
    const tail = list.length ? returnOf(list[list.length - 1]) : null;
    // Anything other than a single `return` as the very last statement.
    const early = list.some((statement, i) =>
      returnOf(statement) ? i < list.length - 1 : hasReturn(statement),
    );
    if (!early) continue;
    if (fn.type === "void") {
      const lowered = lowerBlock(body, () => "");
      source =
        source.slice(0, fn.start) +
        (lowered.includes("portDone") ? "\nbool portDone=false;\n" : "") +
        lowered +
        source.slice(fn.end);
      continue;
    }
    // A value function collects its answer in one variable instead.
    const lowered = lowerBlock(body, (value) => `portResult=${value};`);
    source =
      source.slice(0, fn.start) +
      `\n${fn.type} portResult;\n` +
      (lowered.includes("portDone") ? "bool portDone=false;\n" : "") +
      `${lowered}\nreturn portResult;\n` +
      source.slice(fn.end);
    if (!tail) continue;
  }
  return source;
}
