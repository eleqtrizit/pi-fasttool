#!/usr/bin/env python3
"""Extract standalone grep invocations from grep_examples.txt.

Reads grep_examples.txt (one shell line per entry) and pulls out each full
grep invocation: from the word "grep" through its arguments and operands,
stopping at a top-level pipe, ;, &&, ||, or end of line. Quotes are respected
so a pipe inside quotes does not terminate the match.

Writes one invocation per line to grep_commands.txt.

Usage:
    uv run extract_grep_commands.py [input_file] [output_file]
"""

import re
import sys
from pathlib import Path

DEFAULT_INPUT = "grep_examples.txt"
DEFAULT_OUTPUT = "grep_commands.txt"

# Standalone "grep" not preceded by a word character (so rg, ripgrep, xgrep don't match).
GREP_WORD = re.compile(r"(?<![A-Za-z0-9_])grep(?![A-Za-z0-9_])")

# Top-level separators that end a grep invocation. Matched from left to right,
# skipping anything inside single or double quotes.
SEPARATORS = ("||", "&&", "|", ";")


def is_top_level(line: str, pos: int) -> bool:
    """Return True if ``line[pos:]`` starts outside any quote context."""
    quote: str | None = None
    for ch in line[:pos]:
        if quote:
            if ch == "\\" and quote == '"':
                quote = None
                continue
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
    return quote is None


def extract_invocation(line: str, start: int) -> str | None:
    """Return the grep invocation starting at ``start``, or None if it ends immediately.

    Scans character by character, tracking quote state, and stops at the first
    top-level separator or end of line.
    """
    quote: str | None = None
    for pos in range(start, len(line)):
        ch = line[pos]
        if quote:
            if ch == "\\" and quote == '"':
                continue
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        else:
            for sep in SEPARATORS:
                if line.startswith(sep, pos):
                    return line[start:pos].strip()
    candidate = line[start:].strip()
    # "grep" alone, or "grep " with nothing after, is not a real invocation.
    return candidate if len(candidate) > len("grep") else None


def iter_invocations(source: Path):
    """Yield grep invocation strings found in the input file."""
    for line in source.read_text(encoding="utf-8").splitlines():
        for match in GREP_WORD.finditer(line):
            if not is_top_level(line, match.start()):
                continue
            invocation = extract_invocation(line, match.start())
            if invocation is not None:
                yield invocation


def main() -> int:
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_INPUT)
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(DEFAULT_OUTPUT)

    invocations: list[str] = []
    seen: set[str] = set()
    for invocation in iter_invocations(input_path):
        if invocation not in seen:
            seen.add(invocation)
            invocations.append(invocation)

    output_path.write_text("\n".join(invocations) + ("\n" if invocations else ""), encoding="utf-8")
    print(f"read {input_path}")
    print(f"extracted {len(invocations)} unique grep invocations -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
