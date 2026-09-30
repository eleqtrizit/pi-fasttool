/**
 * Convert grep invocations inside bash commands to ripgrep (rg).
 *
 * A rewritten segment must start (top-level) with the bare word "grep".
 * Flags are converted per the rules below; the pattern and operands are kept
 * verbatim. BRE alternation inside patterns is NOT rewritten (known
 * limitation): `grep "a\|b" f` becomes `rg "a\|b" f`, which changes meaning.
 *
 * Flag rules (grep -> rg):
 * - Drop: -n, -r, -R, -E, -s, -I
 *     * -n/-E: rg defaults; -r/-R: rg is recursive AND rg -r means --replace
 *     * -s: rg -s is case-sensitive, not no-messages; -I: rg skips binary
 * - Map: -h -> -I (no-filename), -L -> --files-without-match
 *     * rg -h is help; rg -L is --follow
 * - Keep: -i -v -c -l -o -q -F -x -w -b -a -P -m -A -B -C -e and long flags
 * - Long flags pass through; unsupported long flags are dropped
 */

const VALUE_SHORT = new Set(["A", "B", "C", "m", "e", "f", "d"]);

const DROP_SHORT = new Set(["n", "r", "R", "E", "s", "I"]);

/** Short flags that map to a different rg flag or long-form name. */
const MAP_SHORT = new Map<string, string>([
  ["h", "-I"],
  ["L", "--files-without-match"],
]);

/** Long flags safe to pass through unchanged. */
const KEEP_LONG = new Set([
  "after-context", "before-context", "context", "max-count",
  "regexp", "file", "include", "exclude", "exclude-dir", "label", "type",
  "invert-match", "ignore-case", "count", "count-matches", "files-with-matches",
  "files-without-match", "no-filename", "only-matching", "quiet",
  "fixed-strings", "word-regexp", "line-regexp", "text", "byte-offset",
  "pcre2", "perl-regexp", "null",
]);

export interface ConvertResult {
  /** The command, with every top-level grep invocation rewritten. */
  command: string;
  /** True when at least one invocation was rewritten. */
  changed: boolean;
}

/** Matches a standalone "grep" word, not rg/ripgrep/xgreap. */
const GREP_WORD = /(?<![A-Za-z0-9_])grep(?![A-Za-z0-9_])/;

/**
 * Convert all top-level grep invocations in a bash command string.
 *
 * Multiline commands are handled line by line; segments are split on
 * top-level pipes, semicolons, and &&/||, and only segments that lead with
 * the bare word "grep" are rewritten.
 */
export function convertGrepCommand(command: string): ConvertResult {
  if (!GREP_WORD.test(command)) {
    return { command, changed: false };
  }
  let changed = false;
  const converted = command.split("\n").map((line) => {
    const parts = splitSegments(line).map((segment) => {
      const result = convertSegment(segment);
      if (result !== segment) {
        changed = true;
      }
      return result;
    });
    return parts.join("");
  });
  return { command: converted.join("\n"), changed };
}

/**
 * Convert one shell line: split into top-level segments, rewrite grep ones.
 * Converts the segment body while preserving any trailing separator.
 */
export function convertSegment(segment: string): string {
  const tail = segment.match(/(\s*(&&|\|\||[|;])\s*)$/);
  const separator = tail ? tail[1] : "";
  const body = separator ? segment.slice(0, segment.length - separator.length) : segment;
  const leading = body.match(/^\s*/);
  const indent = leading ? leading[0] : "";
  const trimmed = body.trim();
  if (trimmed.split(/\s+/, 1)[0] !== "grep") {
    return segment;
  }
  const tokens = tokenize(trimmed);
  if (tokens.length === 0 || tokens[0].text !== "grep") {
    return segment;
  }
  return `${indent}${rewriteInvocation(tokens.map((t) => t.text)).join(" ")}${separator}`;
}

/** Rewrite a token stream whose first token is the bare word "grep". */
export function rewriteInvocation(tokens: string[]): string[] {
  const out: string[] = ["rg"];
  let i = 1;
  let sawArgs = false;
  // Semantics that change how the pattern argument must be treated.
  let fixedStrings = false;
  let perlRegex = false;
  let extendedRegex = false;
  let sawPattern = false;
  while (i < tokens.length && !sawArgs) {
    const text = tokens[i];
    if (text === "--") {
      out.push(text);
      i++;
      sawArgs = true;
      break;
    }
    if (!text.startsWith("-") || text === "-") {
      sawArgs = true;
      break;
    }
    if (text.startsWith("--")) {
      const eq = text.indexOf("=");
      const name = eq === -1 ? text.slice(2) : text.slice(2, eq);
      if (name === "fixed-strings") fixedStrings = true;
      if (name === "pcre2" || name === "perl-regexp") perlRegex = true;
      if (name === "extended-regexp") extendedRegex = true;
      const valueFlag = longTakesValue(name);
      if (KEEP_LONG.has(name) && valueFlag && eq === -1 && i + 1 < tokens.length) {
        // --regexp / --file values are patterns; --include and friends are not.
        const isPattern = name === "regexp";
        const value = isPattern && !fixedStrings && !perlRegex
          ? convertBREPattern(tokens[i + 1])
          : tokens[i + 1];
        out.push(`${text}=${value}`);
        i += 2;
        continue;
      }
      if (KEEP_LONG.has(name) && eq !== -1 && name === "regexp" && !fixedStrings && !perlRegex) {
        out.push(`${text.slice(0, eq)}=${convertBREPattern(text.slice(eq + 1))}`);
        i += 1;
        continue;
      }
      if (KEEP_LONG.has(name)) {
        out.push(text);
        i += 1;
        continue;
      }
      // Unsupported long flag: skip it and its value if it has one.
      i += valueFlag && eq === -1 && i + 1 < tokens.length ? 2 : 1;
      continue;
    }
    // Short form: cluster or attached value.
    const letters = text.slice(1);
    let consumedNext = false;
    for (let li = 0; li < letters.length; li++) {
      const letter = letters[li];
      const isLast = li === letters.length - 1;
      if (letter === "F") fixedStrings = true;
      if (letter === "P") perlRegex = true;
      if (letter === "E") extendedRegex = true;
      if (DROP_SHORT.has(letter)) {
        continue;
      }
      if (MAP_SHORT.has(letter)) {
        out.push(MAP_SHORT.get(letter) as string);
        continue;
      }
      if (VALUE_SHORT.has(letter)) {
        const convertValue = letter === "e" && !fixedStrings && !perlRegex && !extendedRegex;
        if (!isLast) {
          const value = convertValue
            ? convertBREPattern(letters.slice(li + 1))
            : letters.slice(li + 1);
          out.push(`-${letter}${value}`);
        } else if (i + 1 < tokens.length) {
          // Separate value token; normalize "-A -2" to "-A2".
          const value = tokens[i + 1];
          const normalized = /^-\d+$/.test(value) ? value.slice(1) : value;
          const finalValue = convertValue
            ? convertBREPattern(normalized)
            : normalized;
          out.push(`-${letter}${finalValue}`);
          consumedNext = true;
        } else {
          out.push(`-${letter}`);
        }
        break;
      }
      out.push(`-${letter}`);
    }
    i += consumedNext ? 2 : 1;
  }
  while (i < tokens.length) {
    // First remainder token is the pattern operand.
    if (!sawPattern && !fixedStrings && !perlRegex && !extendedRegex) {
      out.push(convertBREPattern(tokens[i]));
      sawPattern = true;
      i++;
      continue;
    }
    out.push(tokens[i]);
    i++;
  }
  return out;
}

/** Long flags that consume a following argument when not using "=". */
function longTakesValue(name: string): boolean {
  return ["after-context", "before-context", "context", "max-count",
    "regexp", "file", "include", "exclude", "exclude-dir", "label", "type"]
    .includes(name);
}

/** Metacharacters that GNU BRE treats literally but ERE (rg) treats specially. */
const BRE_LITERALS = new Set(["|", "(", ")", "+", "?", "{", "}"]);

/** Backslashed characters that BRE turns into metacharacters; rg uses them bare. */
const BRE_TO_ERE = new Map<string, string>([
  ["|", "|"], ["(", "("], [")", ")"], ["+", "+"], ["?", "?"],
  ["{", "{"], ["}", "}"],
]);

/**
 * Convert a GNU BRE pattern to rg-compatible regex syntax.
 *
 * Two symmetric transformations:
 * 1. Unescape BRE metacharacters: `\|` -> `|`, `\(` -> `(`, `\{1,2}` -> `{1,2}`, ...
 * 2. Escape BRE literals: a bare `(`, `)`, `|`, `+`, `?`, `{`, `}` is literal in
 *    BRE but starts a group or quantifier in ERE, so it becomes `\(` etc.
 *
 * Escapes that mean the same in both dialects (`\.`, `\\`, `\d`, `\b` ...) and
 * character class contents are copied verbatim.
 */
export function convertBREPattern(pattern: string): string {
  if (!/[\\|()+?{}]/.test(pattern)) {
    return pattern; // Fast path: nothing convertible.
  }
  let result = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    // Quote characters are shell delimiters copied through; pattern content
    // inside them is still converted.
    if (inClass) {
      result += ch;
      // In shell-token text, backslash-escapes survive; handle \] inside class.
      if (ch === "\\" && i + 1 < pattern.length) {
        result += pattern[i + 1];
        i++;
      } else if (ch === "]") {
        inClass = false;
      }
      continue;
    }
    if (ch === "\\") {
      if (i + 1 >= pattern.length) {
        result += ch;
        continue;
      }
      const next = pattern[i + 1];
      const mapped = BRE_TO_ERE.get(next);
      if (mapped) {
        result += mapped;
      } else {
        result += ch + next;
      }
      i++;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      result += ch;
      // A leading [^ or ] in a class is literal there; still handled by loop.
      continue;
    }
    if (BRE_LITERALS.has(ch)) {
      result += `\\${ch}`;
      continue;
    }
    result += ch;
  }
  return result;
}

interface Token {
  text: string;
}

/**
 * Tokenize a shell segment, respecting single and double quotes.
 * Backslash-escaped double quotes stay inside the token.
 */
export function tokenize(segment: string): Token[] {
  const tokens: Token[] = [];
  let current = "";
  let quote: string | null = null;
  let hasContent = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"') {
        if (i + 1 < segment.length) {
          current += segment[i + 1];
          i++;
        }
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      hasContent = true;
      current += ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (hasContent) {
        tokens.push({ text: current });
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += ch;
    hasContent = true;
  }
  if (hasContent) {
    tokens.push({ text: current });
  }
  return tokens;
}

/**
 * Split a line into top-level segments at |, ;, &&, and ||.
 * Each returned segment keeps its trailing separator (" | ", " ; "...);
 * the final segment has none. Quotes are respected.
 */
export function splitSegments(line: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"') {
        if (i + 1 < line.length) {
          current += line[i + 1];
          i++;
        }
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      segments.push(`${current}${two}`);
      current = "";
      i++;
      continue;
    }
    if (ch === "|" || ch === ";") {
      segments.push(`${current}${ch}`);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}
