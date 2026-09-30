import { describe, expect, it, vi } from "vitest";
import { detectFdTool, type HelpRunner } from "./detect-fd.js";

function runnerFor(results: (boolean | Error)[]): HelpRunner {
  let call = 0;
  return vi.fn(() => {
    const result = results[call++];
    if (result instanceof Error) {
      return Promise.reject(result);
    }
    return Promise.resolve(result);
  });
}

describe("detectFdTool", () => {
  it("returns fd when the fd help text verifies", async () => {
    const runner = runnerFor([true, true]);
    await expect(detectFdTool(runner)).resolves.toBe("fd");
  });

  it("falls back to fdfind when fd fails the help check", async () => {
    await expect(detectFdTool(runnerFor([false, true]))).resolves.toBe("fdfind");
  });

  it("returns null when both fail", async () => {
    await expect(detectFdTool(runnerFor([false, false]))).resolves.toBeNull();
  });

  it("treats runner exceptions as failure", async () => {
    await expect(detectFdTool(runnerFor([new Error("spawn boom"), true]))).resolves.toBe("fdfind");
  });

  it("checks fd before fdfind", async () => {
    const seen: string[] = [];
    await detectFdTool(async (name) => {
      seen.push(name);
      return true;
    });
    expect(seen).toEqual(["fd"]);
  });
});
