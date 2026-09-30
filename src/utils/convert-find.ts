/**
 * Convert find invocations inside bash commands to fd.
 *
 * A command segment is rewritten only when it leads with the bare word
 * "find". The converter is conservative: when an invocation uses boolean
 * logic (-o with non-name predicates), unsupported predicates (-not, -prune,
 * -path, -perm, -newer, -regex, ...), or argument shapes fd cannot express,
 * rewriteFindInvocation returns null and the caller keeps the original find
 * command.
 *
 * Faithfulness notes:
 * - find sees hidden and gitignored files; fd hides both by default, so every
 *   conversion emits "-uu" (--unrestricted) to preserve visibility.
 * - find -size with unit b (512-byte blocks) bails; other units map directly
 *   (c->b, k->k, M->m, G->g).
 * - find -mtime -N becomes --changed-within Nd; +N becomes --changed-before Nd.
 * - Only two -exec shapes convert: "-exec CMD {} ;" -> "-x CMD" and
 *   "-exec CMD {} +" -> "-X CMD".
 */

import { splitSegments, tokenize } from "./convert-grep.js";

export interface ConvertResult {
  /** The command, with every convertible find invocation rewritten. */
  command: string;
  /** True when at least one invocation was rewritten. */
  changed: boolean;
}

/** Matches a bare command word "find", not "findstr" or a path component. */
const FIND_WORD = /(?<![A-Za-z0-9_/.-])find(?![A-Za-z0-9_.-])/;

/** Shell redirection tokens like "2>/dev/null", copied through verbatim. */
const REDIRECTION = /^([012])?(>>|>|&>|&>>)\S*$|^(>>|>|&>|&>>)\S*$/;

/** fd flag letters for find -type values. */
const TYPE_LETTERS = "fdlexpesb";

/** Predicates and qualifiers fd cannot express; conversion bails on these. */
const UNSUPPORTED = new Set([
  "-path", "-wholename", "-prune", "-not", "-perm", "-user", "-group",
  "-nouser", "-nogroup", "-newer", "-newermt", "-regex", "-iregex",
  "-links", "-delete", "-ok", "-okdir", "-printf", "-ls", "-fprintf",
  "-fprint", "-mount", "-xdev", "-context", "-samefile", "-inum", "-fls",
  "-amin", "-atime", "-cmin", "-ctime", "-used", "-gid", "-uid", "-quit",
  "-daystart", "-a", "-and", "-true", "-false",
  "-readable", "-executable", "-writeable", "-H", "-P", "-O",
]);

interface NamePred {
  kind: "name";
  value: string;
  caseInsensitive: boolean;
}

interface SimplePred {
  kind: "flag";
  flag: string; // already-formatted fd flag text
}

type Pred = NamePred | SimplePred;

/**
 * Convert all top-level find invocations in a bash command string to fd.
 *
 * Multiline commands are handled line by line; segments split on top-level
 * separators, and only segments leading with bare "find" are rewritten.
 * Components fd cannot express keep the original find invocation.
 */
export function convertFindCommand(command: string): ConvertResult {
  if (!FIND_WORD.test(command)) {
    return { command, changed: false };
  }
  let changed = false;
  const converted = command.split("\n").map((line) => {
    const parts = splitSegments(line).map((segment) => {
      const result = convertFindSegment(segment);
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
 * Convert one shell segment. Returns the segment unchanged when it does not
 * lead with "find" or when the conversion bails.
 */
export function convertFindSegment(segment: string): string {
  const tail = segment.match(/(\s*(&&|\|\||[|;])\s*)$/);
  const separator = tail ? tail[1] : "";
  const body = separator ? segment.slice(0, segment.length - separator.length) : segment;
  const indent = body.match(/^\s*/)?.[0] ?? "";
  const trimmed = body.trim();
  if (trimmed.split(/\s+/, 1)[0] !== "find") {
    return segment;
  }
  const tokens = tokenize(trimmed).map((t) => t.text);
  if (tokens.length === 0 || tokens[0] !== "find") {
    return segment;
  }
  const rewritten = rewriteFindInvocation(tokens);
  if (rewritten === null) {
    return segment;
  }
  return `${indent}${rewritten.join(" ")}${separator}`;
}

function isRedirection(token: string): boolean {
  return REDIRECTION.test(token);
}

/**
 * Rewrite a find token stream to fd tokens. Returns null when any part uses
 * syntax fd cannot express.
 */
export function rewriteFindInvocation(tokens: string[]): string[] | null {
  const redirectIdx = tokens.findIndex(isRedirection);
  const core = redirectIdx === -1 ? tokens : tokens.slice(0, redirectIdx);
  const redirect = redirectIdx === -1 ? [] : tokens.slice(redirectIdx);

  let i = 1;
  const paths: string[] = [];
  while (i < core.length && !core[i].startsWith("-")) {
    // "." is fd's default search root; dropping it keeps output canonical.
    if (paths.length === 0 && core[i] === ".") {
      i++;
      continue;
    }
    paths.push(core[i]);
    i++;
  }

  const preds: Pred[] = [];
  let sawAnyPred = false;
  let expectNameAfterOr = false;
  let followLinks = false;
  let print0 = false;

  while (i < core.length) {
    const opt = core[i];
    if (opt === "(" || opt === ")" || opt === "!" || UNSUPPORTED.has(opt)) {
      return null;
    }
    switch (opt) {
      case "-name":
      case "-iname": {
        const value = core[i + 1];
        if (value === undefined || value.startsWith("-")) {
          return null;
        }
        expectNameAfterOr = false;
        preds.push({ kind: "name", value, caseInsensitive: opt === "-iname" });
        sawAnyPred = true;
        i += 2;
        break;
      }
      case "-type": {
        const value = core[i + 1];
        if (value === undefined || value.length !== 1 || !TYPE_LETTERS.includes(value)) {
          return null;
        }
        preds.push({ kind: "flag", flag: `-t ${value}` });
        sawAnyPred = true;
        i += 2;
        break;
      }
      case "-maxdepth":
      case "-mindepth": {
        const value = core[i + 1];
        if (value === undefined || !/^\d+$/.test(value)) {
          return null;
        }
        const fdFlag = opt === "-maxdepth" ? "--max-depth" : "--min-depth";
        preds.push({ kind: "flag", flag: `${fdFlag} ${value}` });
        sawAnyPred = true;
        i += 2;
        break;
      }
      case "-mtime":
      case "-mmin": {
        const value = core[i + 1];
        if (value === undefined || !/^[+-]?\d+$/.test(value)) {
          return null;
        }
        const unit = opt === "-mtime" ? "days" : "min";
        const n = value.replace(/^[+-]/, "");
        const flag = value.startsWith("+")
          ? `--changed-before ${n}${unit}`
          : `--changed-within ${n}${unit}`;
        preds.push({ kind: "flag", flag });
        sawAnyPred = true;
        i += 2;
        break;
      }
      case "-size": {
        const value = core[i + 1];
        const match = value?.match(/^([+-]?)(\d+)([ckMG])$/);
        if (!match) {
          return null; // Unitless find sizes are 512-byte blocks; unsafe.
        }
        const unitMap: Record<string, string> = { c: "b", k: "k", M: "m", G: "g" };
        preds.push({ kind: "flag", flag: `--size ${match[1]}${match[2]}${unitMap[match[3]]}` });
        sawAnyPred = true;
        i += 2;
        break;
      }
      case "-empty":
        preds.push({ kind: "flag", flag: "--empty" });
        sawAnyPred = true;
        i++;
        break;
      case "-print":
        i++;
        break;
      case "-print0":
        print0 = true;
        i++;
        break;
      case "-L":
        followLinks = true;
        i++;
        break;
      case "-o":
      case "-or": {
        // Alternation is only supported between name predicates.
        if (!sawAnyPred) {
          return null;
        }
        expectNameAfterOr = true;
        i++;
        break;
      }
      case "-exec":
      case "-execdir": {
        const rest = core.slice(i + 1);
        const brace = rest.indexOf("{}");
        const terminator = brace === -1 ? -1 : brace + 1;
        const termToken = terminator === -1 ? undefined : rest[terminator];
        const plus = termToken === "+" || termToken === "\\+";
        const semi = termToken === ";" || termToken === "\\;";
        if (
          brace === -1 ||
          (!plus && !semi) ||
          brace !== rest.length - 2 ||
          brace === 0 ||
          rest.slice(0, brace).some((t) => t.includes("{") || t.includes("}"))
        ) {
          return null;
        }
        preds.push({ kind: "flag", flag: `${plus ? "-X" : "-x"} ${rest.slice(0, brace).join(" ")}` });
        sawAnyPred = true;
        i = core.length;
        break;
      }
      default: {
        if (!opt.startsWith("-")) {
          // GNU find permutes operands: a bare non-option token here is a
          // path, e.g. "find -L /link -name x".
          paths.push(opt);
          i++;
          break;
        }
        return null; // Unsupported option: bail and keep find.
      }
    }
  }

  if (expectNameAfterOr) {
    return null; // Trailing -o with nothing after it.
  }

  const flagPreds = preds.filter((p): p is SimplePred => p.kind === "flag");
  const namePreds = preds.filter((p): p is NamePred => p.kind === "name");
  // An "or" token only exists between name predicates; if any flag predicate
  // exists in an invocation that also uses -o, bail.
  if (flagPreds.length > 0 && sawOrToken(core)) {
    return null;
  }

  if (flagPreds.length === 0 && namePreds.length > 1) {
    // Name-only alternation chain.
    const caseInsensitive = namePreds.some((p) => p.caseInsensitive);
    if (caseInsensitive !== namePreds.every((p) => p.caseInsensitive)) {
      return null; // Mixed case-sensitivity in one alternation.
    }
    const alternatives = namePreds.map((p) => globToRegex(unquote(p.value))).join("|");
    const pattern = `"^(${alternatives})$"`;
    return buildFdArgs({ flags: caseInsensitive ? ["-uu", "-i"] : ["-uu", "-s"], pattern, paths, redirect });
  }

  const flags = ["-uu"];
  if (followLinks) {
    flags.push("-L");
  }
  if (print0) {
    flags.push("-0");
  }
  for (const flag of flagPreds) {
    flags.push(flag.flag);
  }
  let pattern: string | null = null;
  if (namePreds.length === 1) {
    flags.push(`-g ${namePreds[0].caseInsensitive ? "-i" : "-s"}`);
    pattern = namePreds[0].value;
  } else if (namePreds.length > 1) {
    return null; // ANDed name predicates cannot map to one fd pattern.
  }
  return buildFdArgs({ flags, pattern, paths, redirect });
}

interface FdArgsInput {
  flags: string[];
  pattern: string | null;
  paths: string[];
  redirect: string[];
}

function buildFdArgs({ flags, pattern, paths, redirect }: FdArgsInput): string[] {
  const out: string[] = ["fd"];
  if (flags.length > 0) {
    out.push(flags.join(" "));
  }
  if (pattern !== null) {
    out.push(pattern);
  }
  out.push(...paths);
  out.push(...redirect);
  return out;
}

function sawOrToken(tokens: string[]): boolean {
  return tokens.includes("-o") || tokens.includes("-or");
}

/** Strip one pair of surrounding single or double quotes from a token. */
function unquote(token: string): string {
  const first = token[0];
  const last = token[token.length - 1];
  if (token.length >= 2 && (first === "'" || first === '"') && first === last) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Convert a shell glob (-name value) to a regex fragment for fd.
 * Escapes regex metacharacters, maps * to .* and ? to ., keeps [...] classes.
 */
export function globToRegex(glob: string): string {
  let out = "";
  let inClass = false;
  for (const ch of glob) {
    if (inClass) {
      out += ch;
      if (ch === "]") {
        inClass = false;
      }
      continue;
    }
    if (ch === "[") {
      inClass = true;
      out += ch;
      continue;
    }
    if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else if ("\\^$.|()+{}".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}
