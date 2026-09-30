# AGENTS.md - pi-fasttool

Extensions for the pi coding agent. The repo currently ships one extension: `grep2rg`, which rewrites `grep` invocations in bash tool calls to `rg` with converted flags and BRE patterns.

## How the repo works

Pi loads `extensions/index.ts` (configured as `main` in `package.json`). The default export is a factory receiving `ExtensionAPI`. The extension registers a `tool_call` hook:

1. Narrow to bash tool calls with `isToolCallEventType("bash", event)`.
2. Run the command string through `convertGrepCommand()` from `src/utils/convert-grep.ts`.
3. If `changed` is true, mutate `event.input.command` in place, bump a session counter, set a status-line entry, and show a notice.
4. If not convertible, return `undefined` without touching the input: the original command runs unchanged. Never return `block`.

All conversion logic is pure and lives in `src/utils/`, so it is testable without pi.

## Important files

| File | Role |
|------|------|
| `extensions/index.ts` | Extension entry point. The only code that touches `ExtensionAPI`; keep it thin. |
| `src/utils/convert-grep.ts` | Pure converter: quote-aware tokenizer, segment splitter (pipes, `;`, `&&`, `||`), flag rewriting, BRE-to-ERE pattern conversion. |
| `src/utils/convert-grep.test.ts` | 34 vitest tests. Every behavior change needs a test here. |
| `src/utils/convert-find.test.ts` | 34 vitest tests. Every behavior change needs a test here. |

## Conversion rules (summary)

- Command word: bare top-level `grep` becomes `rg`. `grep=` shell assignments, quoted "grep" strings, and `grepfoo`-style words are never touched.
- Dropped flags: `-n`, `-r`, `-R`, `-E` (rg defaults; `rg -r` means `--replace`), `-s` (rg `-s` is case-sensitive), `-I`.
- Mapped flags: `-h` to `-I` (no-filename; `rg -h` is help), `-L` to `--files-without-match` (rg `-L` is `--follow`).
- Kept flags: `-i -v -c -l -o -q -F -x -w -b -a -P`, context/count/`-e` flags with values, supported long flags. Unrecognized long flags are dropped.
- Patterns: convert BRE to rg regex when the invocation does NOT use `-F`, `-P`/`--pcre2`, or `-E`/`--extended-regexp`. Unescape `\| \+ \? \( \) \{ \}` and escape bare `| ( ) + ? { }` (literal in BRE). Skip conversion inside character classes.
- Known limits: late flags after operands are not converted; process substitution splits lines; authored broken patterns are left as-is.

## Verification commands

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest run
pi -e ./extensions/index.ts                  # live run of the extension
```

Both `npm run typecheck` and `npm test` must pass before any commit.

## When changing the converter

1. Add or update tests in `src/utils/convert-grep.test.ts` first for the flag or pattern case.
2. Keep the conversion tables in the module docstring of `convert-grep.ts` in sync with the code.
3. Update the README.md flag table if user-visible behavior changes.

Ad-hoc verification against real session-mined data happens in the untracked local `helptooling/` directory; its scripts and corpora are documented in `helptooling/README.md` and are not part of this repository.

## pi package reference

Package names: `@earendil-works/pi-coding-agent` and `typebox` are current; `@mariozechner/pi-coding-agent` and `@sinclair/typebox` are obsolete.

After `npm install`, pi docs and examples live under `node_modules/@earendil-works/pi-coding-agent/` (`docs/extensions.md`, `docs/events.md`, `docs/custom-tools.md`, and `examples/extensions/`). Read them before adding new pi API usage.
