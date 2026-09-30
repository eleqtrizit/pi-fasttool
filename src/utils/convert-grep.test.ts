import { describe, expect, it } from "vitest";
import { convertGrepCommand, tokenize, splitSegments } from "./convert-grep.js";

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("grep -n foo bar").map((t) => t.text)).toEqual([
      "grep", "-n", "foo", "bar",
    ]);
  });

  it("keeps quoted strings as one token", () => {
    expect(tokenize('grep "a b|c" file').map((t) => t.text)).toEqual([
      "grep", '"a b|c"', "file",
    ]);
  });

  it("keeps single quotes as one token", () => {
    expect(tokenize("grep 'x;y' f").map((t) => t.text)).toEqual([
      "grep", "'x;y'", "f",
    ]);
  });
});

describe("splitSegments", () => {
  it("splits on top-level pipes and separators, keeping separators attached", () => {
    expect(splitSegments("a | b; c && d || e")).toEqual(["a |", " b;", " c &&", " d ||", " e"]);
  });

  it("does not split inside quotes", () => {
    expect(splitSegments('echo "a|b" ; grep -x y')).toEqual(['echo "a|b" ;', " grep -x y"]);
  });
});

describe("convertGrepCommand", () => {
  const convert = (cmd: string) => convertGrepCommand(cmd).command;

  it("passes non-grep commands through unchanged", () => {
    const cmd = 'rg -n "tool_result" docs.md | head -5';
    expect(convertGrepCommand(cmd)).toEqual({ command: cmd, changed: false });
  });

  it("leaves quoted grep words alone", () => {
    expect(convertGrepCommand('echo "---grep config index---"').changed).toBe(false);
  });

  it("converts a basic invocation", () => {
    expect(convert('grep -n "block" src/a.ts')).toBe('rg "block" src/a.ts');
  });

  it("drops -r and keeps flags with values", () => {
    expect(convert("grep -rn -A5 foo src/")).toBe("rg -A5 foo src/");
  });

  it("expands clusters and drops -n", () => {
    expect(convert("grep -rln pattern")).toBe("rg -l pattern");
  });

  it("maps -h to -I and -L to --files-without-match", () => {
    expect(convert("grep -rl -h pat dir")).toBe("rg -l -I pat dir");
  });

  it("maps -L without recursive flag", () => {
    expect(convert("grep -L pat f")).toBe("rg --files-without-match pat f");
  });

  it("keeps -E but rg needs no flag: drops it", () => {
    expect(convert("grep -E -i 'a|b' f.txt")).toBe("rg -i 'a|b' f.txt");
  });

  it("handles pipelines", () => {
    expect(convert("cat f | grep -cP '\\d' | wc -l")).toBe("cat f | rg -c -P '\\d' | wc -l");
  });

  it("handles separators between segments", () => {
    expect(convert("grep -q foo f; echo ok && grep -v bar f2")).toBe(
      "rg -q foo f; echo ok && rg -v bar f2",
    );
  });

  it("handles separate value tokens and negative values", () => {
    expect(convert("grep -i -A -2 pat f")).toBe("rg -i -A2 pat f");
  });

  it("handles attached count values", () => {
    expect(convert("grep -m5 -B3 pat f")).toBe("rg -m5 -B3 pat f");
  });

  it("preserves multiple -e flags", () => {
    expect(convert("grep -e one -e two f")).toBe("rg -eone -etwo f");
  });

  it("converts long flags and keeps values", () => {
    expect(convert("grep --include=*.py -r pat .")).toBe("rg --include=*.py pat .");
  });

  it("respects -- end of options", () => {
    expect(convert("grep -n -- -weird f")).toBe("rg -- -weird f");
  });

  it("keeps combined -c and -i", () => {
    expect(convert("grep -ci error log.txt")).toBe("rg -c -i error log.txt");
  });

  it("converts multiline commands line by line", () => {
    expect(convert("ls f\ngrep -n x f\nwc -l")).toBe("ls f\nrg x f\nwc -l");
  });

  it("does not match grepfoo or xgrep", () => {
    expect(convertGrepCommand("grepfoo -n x").changed).toBe(false);
    expect(convertGrepCommand("echo xgrep").changed).toBe(false);
  });

  it("handles grep inside $() substitution", () => {
    expect(convert("cd dir && grep -n tag f | head")).toBe("cd dir && rg tag f | head");
  });

  it("converts BRE alternation", () => {
    expect(convert('grep "tool_call\\|SLEEP" f.ts')).toBe('rg "tool_call|SLEEP" f.ts');
  });

  it("converts BRE groups and intervals", () => {
    expect(convert('grep "\\(ab\\)\\{2,3\\}" f')).toBe('rg "(ab){2,3}" f');
  });

  it("escapes BRE literals that are ERE metacharacters", () => {
    expect(convert("grep 'a+b (c|d)' f")).toBe("rg 'a\\+b \\(c\\|d\\)' f");
  });

  it("leaves plain patterns untouched", () => {
    expect(convert("grep error.log f")).toBe("rg error.log f");
  });

  it("skips conversion with -F", () => {
    expect(convert('grep -F "a\\|b" f')).toBe('rg -F "a\\|b" f');
  });

  it("skips conversion with -P in a cluster", () => {
    expect(convert("grep -cP '\\d{3}' f")).toBe("rg -c -P '\\d{3}' f");
  });

  it("converts -e pattern values", () => {
    expect(convert("grep -e 'a\\|b' -e c f")).toBe("rg -e'a|b' -ec f");
  });

  it("does not convert inside character classes but escapes literal braces after them", () => {
    expect(convert("grep '[a(b]{2}' f")).toBe("rg '[a(b]\\{2\\}' f");
  });

  it("keeps common backslash escapes verbatim", () => {
    expect(convert('grep "a\\.b" f')).toBe('rg "a\\.b" f');
  });

  it("keeps changed flag true only when something converted", () => {
    expect(convertGrepCommand("grep -n x f").changed).toBe(true);
  });
});
