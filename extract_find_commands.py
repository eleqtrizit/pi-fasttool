#!/usr/bin/env python3
"""Extract standalone find invocations from find_examples.txt.

Reads find_examples.txt (one shell line per entry) and pulls out each find
invocation: from the command word "find" through its operands, stopping at a
top-level pipeline, ;, &&, ||, or end of line. Quotes are respected.

Writes one invocation per line to find_commands.txt.

Usage:
    uv run extract_find_commands.py [input_file] [output_file]
"""

import re
import sys
from pathlib import Path

DEFAULT_INPUT = "find_examples.txt"
DEFAULT_OUTPUT = "find_commands.txt"

FIND_WORD = re.compile(r"(?<![A-Za-z0-9_/.-])find(?![A-Za-z0-9_.-])")

SEPARATORS = ("||", "&&", "|", ";")


def is_top_level(line: str, pos: int) -> bool:
    """Return True if ``line[pos:]`` starts outside any quote context."""
    quote: str | None = None
    i = 0
    while i < pos:
        ch = line[i]
        if ch == "\\":
            i += 2
            continue
        if quote:
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        i += 1
    return quote is None


def extract_invocation(line: str, start: int) -> str | None:
    """Return the find invocation starting at ``start``, or None if bare."""
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
                    candidate = line[start:pos].strip()
                    return candidate if candidate != "find" else None
    candidate = line[start:].strip()
    return candidate if candidate != "find" else None


def main() -> int:
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_INPUT)
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(DEFAULT_OUTPUT)

    invocations: list[str] = []
    seen: set[str] = set()
    for line in input_path.read_text(encoding="utf-8").splitlines():
        for match in FIND_WORD.finditer(line):
            if not is_top_level(line, match.start()):
                continue
            # Only a command position: start of line, after a separator, or
            # after xargs/sudo/env-style wrapper words.
            before = line[: match.start()].rstrip()
            if before and not before.endswith(("|", ";", "&")):
                wrapper = before.split()[-1]
                if wrapper not in ("xargs", "sudo", "env", "time", "nice", "sh", "-c", "bash", "do", "then", "else"):
                    continue
            invocation = extract_invocation(line, match.start())
            if invocation is not None and invocation not in seen:
                seen.add(invocation)
                invocations.append(invocation)

    output_path.write_text("\n".join(invocations) + ("\n" if invocations else ""), encoding="utf-8")
    print(f"read {input_path}")
    print(f"extracted {len(invocations)} unique find invocations -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
