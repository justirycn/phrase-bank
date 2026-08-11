import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { stopChildProcess } from "../../scripts/processLifecycle";

describe("benchmark child process lifecycle", () => {
  it("does not resolve until the spawned process has exited", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    await stopChildProcess(child);

    expect(child.exitCode ?? child.signalCode).not.toBeNull();
  });
});
