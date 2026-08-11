import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface StartupCallSite { file: string; functionName: string; }
export interface StartupSourceMetrics { files: string[]; exportSnapshotCallSites: number; callSites: StartupCallSite[]; }

function localImportFiles(file: string, source: string) {
  const files: string[] = [];
  for (const match of source.matchAll(/^\s*import\s+(?!\()[\s\S]*?\sfrom\s+["'](\.[^"']+)["'];?/gm)) {
    const base = resolve(dirname(file), match[1]);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
      if (existsSync(candidate)) { files.push(candidate); break; }
    }
  }
  return files;
}

function matchingBody(source: string, open: number) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(open + 1, index);
  }
  return "";
}

function functionBody(source: string, name: string) {
  const patterns = [
    new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{`),
    new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(?:useCallback\\s*\\()?\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) return matchingBody(source, match.index + match[0].lastIndexOf("{"));
  }
  const expression = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*([^;]+);`).exec(source);
  if (expression) return expression[1];
  return "";
}

export function analyzeStartupSource(root: string): StartupSourceMetrics {
  const appRoot = join(root, "app");
  const entry = join(appRoot, "PhraseBankApp.tsx");
  const pending = [entry]; const visited = new Set<string>(); const callSites: StartupCallSite[] = [];
  while (pending.length) {
    const file = pending.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    pending.push(...localImportFiles(file, source));
    for (const functionName of ["refresh", "loadHomeData"]) {
      const body = functionBody(source, functionName);
      const count = [...body.matchAll(/\.exportSnapshot\s*\(/g)].length;
      callSites.push(...Array.from({ length: count }, () => ({ file: relative(root, file).replaceAll("\\", "/"), functionName })));
    }
  }
  return { files: [...visited].map((file) => relative(root, file).replaceAll("\\", "/")).sort(), exportSnapshotCallSites: callSites.length, callSites };
}
