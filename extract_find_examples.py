#!/usr/bin/env python3
"""Extract bash tool-call lines that invoke find from pi session files.

Scans ~/.pi/agent/sessions/**/*.jsonl for bash tool calls whose command
contains a "find" command word. Because "find" is a common English word and
path component, a line only counts when a bare command word "find" is present
AND one of the common find predicate flags appears in the line.

Multiline commands are split into lines; each matching line is written
verbatim, one per line, to find_examples.txt.

Usage:
    uv run extract_find_examples.py [output_file]
"""

import json
import re
import sys
from pathlib import Path

SESSIONS_DIR = Path.home() / ".pi" / "agent" / "sessions"
DEFAULT_OUTPUT = "find_examples.txt"

# Bare command word "find", not a path component or substring.
FIND_WORD = re.compile(r"(?<![A-Za-z0-9_/.-])find(?![A-Za-z0-9_.-])")

# Predicate flags that make a "find" word plausibly an actual find invocation.
FIND_FLAGS = re.compile(
    r"\s(-name|-iname|-type|-exec|-execdir|-ok|-mtime|-mmin|-size|-maxdepth"
    r"|-mindepth|-perm|-user|-group|-newer|-regex|-iregex|-empty|-links"
    r"|-delete|-print|-printf|-ls|-prune|-path|-wholename)\b"
)


def iter_tool_lines(session_file: Path):
    """Yield shell lines from bash tool calls in one session file."""
    try:
        fh = session_file.open(encoding="utf-8")
    except OSError as exc:
        print(f"warning: cannot read {session_file}: {exc}", file=sys.stderr)
        return
    with fh:
        for line in fh:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            message = entry.get("message") or {}
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for item in content:
                if item.get("type") != "toolCall" or item.get("name") != "bash":
                    continue
                command = (item.get("arguments") or {}).get("command")
                if isinstance(command, str):
                    yield from command.splitlines()


def is_find_line(line: str) -> bool:
    """True when the line contains a find command word plus a find flag."""
    if not FIND_WORD.search(line):
        return False
    if not FIND_FLAGS.search(line):
        return False
    # "find" must appear as the leading word of some top-level segment.
    for segment in re.split(r"\||&&|;|\|\||\$\(|`,|`", line):
        token = segment.strip().split()
        if token and re.sub(r"^\$", "", token[0]) == "find":
            return True
    return False


def main() -> int:
    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_OUTPUT)
    matches: list[str] = []
    seen: set[str] = set()
    files_scanned = 0

    for session_file in sorted(SESSIONS_DIR.rglob("*.jsonl")):
        files_scanned += 1
        for shell_line in iter_tool_lines(session_file):
            if is_find_line(shell_line) and shell_line not in seen:
                seen.add(shell_line)
                matches.append(shell_line)

    output_path.write_text("\n".join(matches) + ("\n" if matches else ""), encoding="utf-8")
    print(f"scanned {files_scanned} session files")
    print(f"found {len(matches)} unique find command lines -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
