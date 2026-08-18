import { lstat, mkdtemp, readdir, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

interface TrackedRoot { path: string; prefix: string; }

async function removeExactTreeWithoutFollowingLinks(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    await rm(path, { force: true });
    return;
  }
  for (const name of await readdir(path)) await removeExactTreeWithoutFollowingLinks(join(path, name));
  await rmdir(path);
}

export function createTempRootTracker() {
  const roots: TrackedRoot[] = [];

  const create = async (prefix: string) => {
    if (!/^phrase-bank-[a-z0-9-]+-$/u.test(prefix)) throw new Error(`Unsafe test temp prefix: ${prefix}`);
    const path = await mkdtemp(join(tmpdir(), prefix));
    roots.push({ path, prefix });
    return path;
  };

  const cleanup = async () => {
    for (const tracked of roots.splice(0).reverse()) {
      const path = resolve(tracked.path);
      const tempDirectory = resolve(tmpdir());
      const sameParent = process.platform === "win32"
        ? dirname(path).toLowerCase() === tempDirectory.toLowerCase()
        : dirname(path) === tempDirectory;
      if (!sameParent || !basename(path).startsWith(tracked.prefix) || path === tempDirectory || !path.startsWith(`${tempDirectory}${sep}`)) {
        throw new Error(`Refusing unsafe test temp cleanup: ${path}`);
      }
      const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!metadata) continue;
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`Refusing non-directory test temp cleanup: ${path}`);
      await removeExactTreeWithoutFollowingLinks(path);
      await lstat(path).then(
        () => { throw new Error(`Test temp root residue remains: ${path}`); },
        (error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; },
      );
    }
  };

  return { create, cleanup };
}
