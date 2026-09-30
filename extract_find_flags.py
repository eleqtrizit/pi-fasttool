#!/usr/bin/env python3
"""Analyze find invocations: tally option tokens and dump token streams.

Reads find_commands.txt with shlex, and produces:
- find_flag_counts.txt: every option token (-name, -type, ...) sorted by count
- find_tokens.txt: one shlex token stream per invocation, space-joined

Usage:
    uv run extract_find_flags.py [input_file]
"""

import shlex
import sys
from collections import Counter
from pathlib import Path

import re

DEFAULT_INPUT = "find_commands.txt"


def analyze(invocations: list[str]):
    counts: Counter[str] = Counter()
    token_lines: list[str] = []
    malformed = 0
    for invocation in invocations:
        try:
            tokens = shlex.split(invocation)
        except ValueError:
            malformed += 1
            continue
        token_lines.append(" ".join(tokens))
        for token in tokens[1:]:
            if token.startswith("-") and len(token) > 1 and not re.match(r"^-+(\.|\d)", token):
                counts[token] += 1
    return counts, token_lines, malformed


def main() -> int:
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_INPUT)
    invocations = input_path.read_text(encoding="utf-8").splitlines()
    counts, token_lines, malformed = analyze(invocations)

    Path("find_flag_counts.txt").write_text(
        "\n".join(f"{count:6d}  {flag}" for flag, count in counts.most_common()) + "\n",
        encoding="utf-8",
    )
    Path("find_tokens.txt").write_text(
        "\n".join(token_lines) + "\n", encoding="utf-8"
    )
    print(f"analyzed {len(invocations)} invocations ({malformed} unquoted-skipped)")
    print(f"top 15 options:")
    for flag, count in counts.most_common(15):
        print(f"  {count:6d}  {flag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
