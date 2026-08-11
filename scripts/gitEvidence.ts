import { execFileSync } from "node:child_process";

type GitExec = (file: string, args: string[], options: { cwd: string; encoding: "utf8" }) => string;

export function readCurrentAppTree(root: string, execute: GitExec = execFileSync as GitExec) {
  try {
    return execute("git", ["rev-parse", "HEAD:app"], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
