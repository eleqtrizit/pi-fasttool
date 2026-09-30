import { describe, expect, it } from "vitest";
import { convertFindCommand, globToRegex } from "./convert-find.js";

describe("globToRegex", () => {
  it("converts globs to regex fragments", () => {
    expect(globToRegex("*.ts")).toBe(".*\\.ts");
    expect(globToRegex("pi-*.sh")).toBe("pi-.*\\.sh");
    expect(globToRegex("a?c")).toBe("a.c");
    expect(globToRegex("[ab].txt")).toBe("[ab]\\.txt");
    expect(globToRegex("no-metachars")).toBe("no-metachars");
  });
});

describe("convertFindCommand", () => {
  const convert = (cmd: string) => convertFindCommand(cmd).command;

  it("passes non-find commands through unchanged", () => {
    const cmd = "rg -n foo src/";
    expect(convertFindCommand(cmd)).toEqual({ command: cmd, changed: false });
  });

  it("converts a simple name search with a path", () => {
    expect(convert('find /tmp -name "*.md"')).toBe('fd -uu -g -s "*.md" /tmp');
  });

  it("converts -iname to case-insensitive glob", () => {
    expect(convert("find . -iname 'readme*'")).toBe("fd -uu -g -i 'readme*'");
  });

  it("drops bare -print", () => {
    expect(convert("find . -name x -print")).toBe("fd -uu -g -s x");
  });

  it("converts -print0 to -0", () => {
    expect(convert("find . -name x -print0")).toBe("fd -uu -0 -g -s x");
  });

  it("converts -type", () => {
    expect(convert("find src -type f -name '*.ts'")).toBe("fd -uu -t f -g -s '*.ts' src");
  });

  it("converts depth options", () => {
    expect(convert("find . -maxdepth 2 -mindepth 1 -name y")).toBe(
      "fd -uu --max-depth 2 --min-depth 1 -g -s y",
    );
  });

  it("converts -mtime to changed-within and changed-before", () => {
    expect(convert("find . -mtime -7 -type f")).toBe("fd -uu --changed-within 7days -t f");
    expect(convert("find . -mtime +30 -type f")).toBe("fd -uu --changed-before 30days -t f");
  });

  it("converts -size with units", () => {
    expect(convert("find . -size +10M -type f")).toBe("fd -uu --size +10m -t f");
    expect(convert("find . -size -5k")).toBe("fd -uu --size -5k");
  });

  it("converts -empty", () => {
    expect(convert("find /tmp -type f -empty")).toBe("fd -uu -t f --empty /tmp");
  });

  it("converts -L", () => {
    expect(convert("find -L /link -name x")).toBe("fd -uu -L -g -s x /link");
  });

  it("converts multiple paths", () => {
    expect(convert("find dir1 dir2 -name '*.yml'")).toBe("fd -uu -g -s '*.yml' dir1 dir2");
  });

  it("converts a list-everything find to unrestricted fd", () => {
    expect(convert("find /somedir -type f")).toBe("fd -uu -t f /somedir");
  });

  it("preserves trailing redirections verbatim", () => {
    expect(convert("find . -name x 2>/dev/null")).toBe("fd -uu -g -s x 2>/dev/null");
  });

  it("converts -o chains of name predicates to anchored regex", () => {
    expect(convert('find . -name "*.a" -o -name "*.b"')).toBe(
      'fd -uu -s "^(.*\\.a|.*\\.b)$"',
    );
  });

  it("converts an -iname alternation with explicit -i", () => {
    expect(convert("find . -iname 'cat*' -o -iname 'dog*'")).toBe(
      'fd -uu -i "^(cat.*|dog.*)$"',
    );
  });

  it("bails on -o mixed with non-name predicates", () => {
    const cmd = 'find . -name "*.a" -o -type d';
    expect(convert(cmd)).toBe(cmd);
  });

  it("bails on -not", () => {
    const cmd = "find . -not -name x";
    expect(convert(cmd)).toBe(cmd);
  });

  it("bails on -prune and -path", () => {
    const cmd = 'find . -path ./vendor -prune -o -name "*.js" -print';
    expect(convert(cmd)).toBe(cmd);
  });

  it("bails on -perm, -newer, and -regex", () => {
    for (const cmd of [
      "find . -perm 777",
      "find . -newer ref.txt",
      "find . -regex '.*foo.*'",
    ]) {
      expect(convert(cmd)).toBe(cmd);
    }
  });

  it("bails on -delete, -printf, and -ls", () => {
    for (const cmd of [
      "find . -name x -delete",
      "find . -printf '%p\\n'",
      "find . -type f -ls",
    ]) {
      expect(convert(cmd)).toBe(cmd);
    }
  });

  it("bails on -size without a convertible unit", () => {
    const cmd = "find . -size +100";
    expect(convert(cmd)).toBe(cmd);
  });

  it("handles pipelines keeping other segments intact", () => {
    expect(convert("cat f | find . -name x | head")).toBe("cat f | fd -uu -g -s x | head");
  });

  it("bails on unsupported -exec shapes", () => {
    const cmd = 'find . -name x -exec cp {} /tmp/ \\;';
    expect(convert(cmd)).toBe(cmd);
  });

  it("leaves lines citing find as a word untouched", () => {
    expect(convertFindCommand('echo "cannot find file"').changed).toBe(false);
  });
});
