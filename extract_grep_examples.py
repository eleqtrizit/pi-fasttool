#!/usr/bin/env python3
"""Extract bash tool calls containing grep-like commands from pi session files.

Scans ~/.pi/agent/sessions/**/*.jsonl, finds every toolCall with name "bash"
whose command uses grep (word-boundary match, so rg/ripgrep don't count),
and writes one command per line to grep_examples.txt.

Usage:
    uv run extract_grep_examples.py [output_file]
"""

import json
import sys
from pathlib import Path

SESSIONS_DIR = Path.home() / ".pi" / "agent" / "sessions"
DEFAULT_OUTPUT = "grep_examples.txt"

# Matches standalone "grep" but not "rg", "ripgrep", or "grepabort"-style words.
GREP_PATTERN = r"\bgrep\b"


def iter_bash_commands(session_file: Path):
    """Yield bash command strings from one session JSONL file."""
    try:
        with session_file.open(encoding="utf-8") as fh:
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
                    if not isinstance(command, str):
                        continue
                    for cmd_line in command.splitlines():
                        if re_search(cmd_line):
                            yield cmd_line
    except OSError as exc:
        print(f"warning: cannot read {session_file}: {exc}", file=sys.stderr)


def main() -> int:
    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_OUTPUT)
    matches: list[str] = []
    seen: set[str] = set()
    files_scanned = 0

    for session_file in sorted(SESSIONS_DIR.rglob("*.jsonl")):
        files_scanned += 1
        for command in iter_bash_commands(session_file):
            if re_search(command) and command not in seen:
                seen.add(command)
                matches.append(command)

    output_path.write_text("\n".join(matches) + ("\n" if matches else ""), encoding="utf-8")
    print(f"scanned {files_scanned} session files")
    print(f"found {len(matches)} unique grep commands -> {output_path}")
    return 0


def re_search(text: str):
    """Regex search helper kept separate so the pattern lives in one place."""
    import re

    return re.search(GREP_PATTERN, text)


if __name__ == "__main__":
    raise SystemExit(main())
