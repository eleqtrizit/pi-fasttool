/**
 * Detect the local fd-find binary name.
 *
 * Some distributions install the executable as "fd" and Debian/Ubuntu as
 * "fdfind". A name only counts when `NAME --help | rg sharkdp` succeeds,
 * which proves the help text references https://github.com/sharkdp/fd and
 * therefore that the binary is fd-find, not fd (Find) or another tool.
 *
 * Detection order: "fd" first, then "fdfind". Returns null when neither
 * verifies.
 */

import { exec } from "node:child_process";

export type FdToolName = "fd" | "fdfind";

/** Candidates in detection-priority order. */
const CANDIDATES: readonly FdToolName[] = ["fd", "fdfind"];

/** Runs `NAME --help | rg sharkdp`; resolves true when it exits zero. */
export type HelpRunner = (name: FdToolName) => Promise<boolean>;

function defaultRunner(name: FdToolName): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`${name} --help | rg sharkdp`, { timeout: 10_000 }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Return the local fd-find binary name, or null when absent.
 *
 * @param runner Help verifier; inject a fake in tests. Defaults to a shell runner.
 * @returns An element of ["fd", "fdfind"], or null when neither verifies.
 */
export async function detectFdTool(
  runner: HelpRunner = defaultRunner,
): Promise<FdToolName | null> {
  for (const name of CANDIDATES) {
    let ok: boolean;
    try {
      ok = await runner(name);
    } catch {
      ok = false;
    }
    if (ok) {
      return name;
    }
  }
  return null;
}
