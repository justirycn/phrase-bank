import type { ChildProcess } from "node:child_process";

export async function stopChildProcess(child: ChildProcess, timeoutMilliseconds = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Child process ${child.pid ?? "unknown"} did not exit after termination`)), timeoutMilliseconds);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    if (!child.kill()) {
      clearTimeout(timeout);
      reject(new Error(`Could not terminate child process ${child.pid ?? "unknown"}`));
    }
  });
}
