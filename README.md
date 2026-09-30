# pi-fasttool

Extensions for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). Ships `grep2rg`: an extension that rewrites `grep` commands issued by bash tool calls into `rg` (ripgrep) with converted flags and patterns.

## Quick Start

Install into pi:

```bash
pi install https://github.com/eleqtrizit/pi-fasttool
```

That places the extension where pi auto-discovers it. Restart pi (or run `/reload`) and every bash tool call that invokes `grep` is rewritten to `rg` before execution. A `grep2rg` entry in the status line tracks conversions for the session, and each rewrite shows a notice with the original and converted command.

## What grep2rg converts

Intercepted commands are scanned for bare, top-level `grep` invocations (pipelines, `&&`/`||`, multiline commands are all handled; quoted strings and shell variables named `grep` are left alone).

Flags:

| grep flag | rg result | Why |
|-----------|-----------|-----|
| `-n`, `-r`, `-R`, `-E` | dropped | rg defaults; `rg -r` would mean `--replace` |
| `-h` | `-I` | no-filename; `rg -h` prints help |
| `-L` | `--files-without-match` | `rg -L` means `--follow` |
| `-s`, `-I` | dropped | rg `-s` is case-sensitive; binary is skipped anyway |
| all others | kept | `-i -v -c -l -o -q -F -x -w -b -a -P`, context/count/`-e` flags |

Patterns: GNU BRE syntax converts to the regex dialect rg uses. `\|` becomes `|`, `\(...\)` becomes `(...)`, and bare `( ) | + ? { }` (literal in BRE) are escaped so they stay literal. Conversion is skipped when the invocation uses `-F` or `-P`/`--pcre2`. BRE alternation and groups are NOT rewritten for `-E` patterns, which are already ERE.

Fallback: commands that cannot be converted run unchanged. Mixed commands convert what is convertible and keep the rest verbatim.

## Repository layout

```
extensions/index.ts   grep2rg extension: tool_call hook, TUI notice, session status
src/utils/convert-grep.ts   Pure conversion logic (tokenizer, splitter, flag + BRE rewriting)
src/utils/convert-grep.test.ts   34 vitest tests
extract_grep_*.py     uv scripts that mined ~3200 pi session files for real grep usage
grep_commands.txt     5754 unique grep invocations extracted from session history
```

## Development

```bash
npm install
npm run typecheck
npm test
pi -e ./extensions/index.ts     # run the extension directly
```

Package names: `@earendil-works/pi-coding-agent` and `typebox` are current; `@mariozechner/pi-coding-agent` and `@sinclair/typebox` are obsolete.

## Documentation

After `npm install`, docs and examples ship inside the pi package:

- Docs: `node_modules/@earendil-works/pi-coding-agent/docs/` (start with `extensions.md` and `writing-an-extension.md`)
- Examples: `node_modules/@earendil-works/pi-coding-agent/examples/extensions/`
