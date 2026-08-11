import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const SCREEN_MODULES = [
  "app/components/screens/LibraryScreen.tsx",
  "app/components/screens/AddPhraseScreen.tsx",
  "app/components/screens/SettingsScreen.tsx",
  "app/components/screens/ReviewScreen.tsx",
  "app/components/screens/PracticeScreen.tsx",
  "app/components/screens/LearningScreen.tsx",
] as const;

export const HOME_BUILD_BUDGETS = {
  // Optimized build: 55,212 B. This permits about 15% growth.
  homeChunkBytes: 63_500,
  // Optimized build: 483,723 B of uncompressed initial JavaScript.
  initialJavaScriptBytes: 556_500,
} as const;

type ClientAssets = {
  appBootstrapPreinitModules?: string[];
  dynamicPreloads: Record<string, string[]>;
};

type RscAssets = {
  bootstrapScriptContent?: string;
  clientReferenceDeps: Record<string, { js?: string[] }>;
};

function normalize(file: string) {
  return file.replaceAll("\\", "/").replace(/^\//, "");
}

function parseDefaultExport(path: string) {
  const source = readFileSync(path, "utf8").trim();
  return JSON.parse(source.replace(/^export default\s+/, "").replace(/;$/, ""));
}

function listSizes(root: string, current = root, result: Record<string, number> = {}) {
  for (const name of readdirSync(current)) {
    const path = join(current, name);
    const entry = statSync(path);
    if (entry.isDirectory()) listSizes(root, path, result);
    else result[normalize(relative(root, path))] = entry.size;
  }
  return result;
}

export function analyzeHomeBuildManifest(input: {
  clientAssets: ClientAssets;
  rscAssets: RscAssets;
  sizes: Record<string, number>;
}) {
  const homePreloads = input.clientAssets.dynamicPreloads["app/PhraseBankApp.tsx"] ?? [];
  const homeChunk = homePreloads.map(normalize).find((file) => /\/PhraseBankApp-[^/]+\.js$/.test(`/${file}`));
  if (!homeChunk) throw new Error("Production manifest does not contain the PhraseBankApp chunk; run npm run build.");

  const homeReference = Object.values(input.rscAssets.clientReferenceDeps)
    .find(({ js = [] }) => js.map(normalize).includes(homeChunk));
  if (!homeReference) throw new Error("RSC asset manifest does not identify the home client reference.");

  const bootstrap = input.rscAssets.bootstrapScriptContent?.match(/import\(["']\/([^"']+\.js)["']\)/)?.[1];
  const initialFiles = [...new Set([...(homeReference.js ?? []), ...(input.clientAssets.appBootstrapPreinitModules ?? []), ...(bootstrap ? [bootstrap] : [])].map(normalize))].sort();
  const screenChunks = Object.fromEntries(SCREEN_MODULES.map((module) => {
    const name = module.match(/([^/]+)\.tsx$/)?.[1];
    const chunk = (input.clientAssets.dynamicPreloads[module] ?? []).map(normalize)
      .find((file) => file.includes(`/chunks/${name}-`) && file.endsWith(".js"));
    if (!chunk) throw new Error(`Production manifest does not contain a distinct chunk for ${module}.`);
    return [module, chunk];
  }));

  return {
    homeChunk,
    homeChunkBytes: input.sizes[homeChunk] ?? 0,
    initialFiles,
    initialJavaScriptBytes: initialFiles.reduce((sum, file) => sum + (input.sizes[file] ?? 0), 0),
    screenChunks,
  };
}

export function analyzeHomeBuild(projectRoot: string) {
  const clientRoot = join(projectRoot, "dist/client");
  return analyzeHomeBuildManifest({
    clientAssets: parseDefaultExport(join(projectRoot, "dist/server/vinext-client-assets.js")),
    rscAssets: parseDefaultExport(join(projectRoot, "dist/server/__vite_rsc_assets_manifest.js")),
    sizes: listSizes(clientRoot),
  });
}
