import {
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { convertGrepCommand } from "../src/utils/convert-grep.js";
import { convertFindCommand } from "../src/utils/convert-find.js";
import { detectFdTool, type FdToolName } from "../src/utils/detect-fd.js";

/**
 * fasttool extension: rewrites legacy search commands in bash tool calls.
 *
 * - grep2rg: every bare top-level grep invocation becomes rg with converted
 *   flags and BRE patterns (see src/utils/convert-grep.ts).
 * - find2fd: every bare top-level find invocation becomes fd (name resolved
 *   once per session via detect-fd.ts). Unconvertible predicates bail and
 *   keep the original find command.
 *
 * Commands that cannot be converted run unchanged. The TUI shows a notice
 * per rewrite and a running conversion count in the status line.
 */
export default function (pi: ExtensionAPI) {
  let convertedCount = 0;
  let fdToolPromise: Promise<FdToolName | null> | null = null;

  const getFdTool = (): Promise<FdToolName | null> => {
    if (fdToolPromise === null) {
      fdToolPromise = detectFdTool();
    }
    return fdToolPromise;
  };

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return undefined;
    }
    const original = event.input.command as string;

    // One pass per converter; find runs on the grep-rewritten text.
    const grep = convertGrepCommand(original);
    const fdTool = await getFdTool();
    const find = fdTool === null
      ? { command: grep.command, changed: false }
      : convertFindCommand(grep.command);

    const changed = grep.changed || find.changed;
    if (!changed) {
      return undefined; // Fallback: original command runs unchanged.
    }
    event.input.command = find.command;
    convertedCount++;
    ctx.ui.setStatus("fasttool", `${convertedCount} converted this session`);
    ctx.ui.notify(
      `fasttool: ${truncate(original)}\n      -> ${truncate(find.command)}`,
      "warning",
    );
    return undefined;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("fasttool", undefined);
  });
}

/** Collapse a command to a single compact line for the notification. */
function truncate(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 87)}...` : flat;
}
