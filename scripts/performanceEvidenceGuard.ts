export function assertCleanAppTree(status: string) {
  const changes = status.trim();
  if (changes) throw new Error(`Cannot measure performance while the app source tree is dirty:\n${changes}`);
}
