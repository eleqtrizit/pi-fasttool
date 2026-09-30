#!/usr/bin/env python3
"""Extract the flags from grep invocations in grep_commands.txt.

Reads grep_commands.txt (one grep invocation per line), tokenizes each
invocation with shlex, and collects the leading flag tokens, stopping at the
first non-flag token (the pattern). Short-flag clusters are expanded into
individual flags: "-rn" becomes "-r -n". Flags that take values keep them
attached ("-A 2" stays as "-A2", "--include=*.py" stays as-is).

Writes one space-separated flag set per line to grep_flags.txt.

Usage:
    uv run extract_grep_flags.py [input_file] [output_file]
"""

import shlex
import sys
from pathlib import Path

DEFAULT_INPUT = "grep_commands.txt"
DEFAULT_OUTPUT = "grep_flags.txt"

# Short flags consumed together with the following argument when not attached.
VALUE_FLAGS_SHORT = {"A", "B", "C", "m", "f", "d", "P", "e"}

# Long flags consumed together with the following argument; "=" attached forms
# are handled separately.
VALUE_FLAGS_LONG = {
    "--include", "--exclude", "--exclude-dir", "--include-dir",
    "--max-count", "--after-context", "--before-context", "--context",
    "--regexp", "--file", "--label", "--separator", "--color",
}


def split_cluster(flag: str) -> list[str]:
    """Expand a short-flag cluster like "-rn" into ["-r", "-n"].

    Attached value forms such as "-A2" or "-m3" return as a single token so the
    value is not lost.
    """
    letters = flag[1:]
    if len(letters) == 1:
        return [flag]
    if letters[0] in VALUE_FLAGS_SHORT:
        return [f"-{letters}"]
    return [f"-{ch}" for ch in letters]


def normalize_flag(flag: str) -> list[str]:
    """Normalize one argument token into canonical flag tokens, or [] to skip.

    Returns an empty list for tokens that are not flags (patterns, operands,
    and the "--" end-of-options marker is also kept out).
    """
    if flag == "--":
        return []
    if flag.startswith("--"):
        return [flag]
    if flag.startswith("-"):
        return split_cluster(flag)
    return []


def extract_flags(invocation: str) -> list[str] | None:
    """Return the normalized leading flags of a grep invocation, or None.

    Scans tokens after "grep"; stops at the first non-flag token (the pattern).
    Also recognizes attached value forms such as "--include=*.py".
    """
    try:
        tokens = shlex.split(invocation)
    except ValueError:
        return None
    if not tokens or tokens[0] != "grep":
        return None

    flags: list[str] = []
    i = 1
    while i < len(tokens):
        token = tokens[i]
        if not token.startswith("-") or token == "-":
            break  # first operand reached: the pattern
        if token.startswith("--"):
            if token in VALUE_FLAGS_LONG:
                if i + 1 < len(tokens):
                    flags.append(f"{token}={tokens[i + 1]}")
                    i += 2
                    continue
                return None  # dangling flag: malformed invocation
            if "=" in token:
                name = token.split("=", 1)[0]
                if name in VALUE_FLAGS_LONG:
                    flags.append(token)
                    i += 1
                    continue
                break  # unknown --flag=... : treat as pattern-adjacent, stop
            flags.append(token)
            i += 1
        else:
            expanded = split_cluster(token)
            letters = token[1:]
            if letters and letters[-1] in VALUE_FLAGS_SHORT and token not in ("-",):
                # Value attached: -A2. If value is separate (-A 2), grab it.
                if len(letters) == 1 and i + 1 < len(tokens):
                    flags.append(f"{token}{tokens[i + 1]}")
                    i += 2
                    continue
                flags.append(token)
                i += 1
                continue
            flags.extend(normalize_flag(token))
            i += 1
    return flags or None


def main() -> int:
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_INPUT)
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(DEFAULT_OUTPUT)

    lines: list[str] = []
    skipped = 0
    for invocation in input_path.read_text(encoding="utf-8").splitlines():
        flags = extract_flags(invocation)
        if flags is None:
            skipped += 1
            continue
        lines.append(" ".join(flags))

    output_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    print(f"read {input_path}")
    print(f"extracted flags from {len(lines)} invocations ({skipped} skipped)"
          f" -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
