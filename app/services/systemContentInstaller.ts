import { validateSystemContentPackage } from "../domain/systemContent";
import type { SystemContentPackage } from "../domain/types";
import { BUNDLED_SYSTEM_CONTENT_VERSION } from "../domain/bundledSystemContent";

const BUNDLED_URL = `/content/system-content-${BUNDLED_SYSTEM_CONTENT_VERSION}.json`;

type ContentRepository = {
  getActiveSystemContentVersion(): Promise<string | undefined>;
  installSystemContentPackage(content: SystemContentPackage): Promise<void>;
};

export async function installBundledSystemContent(
  repository: ContentRepository,
  fetcher: typeof fetch = fetch,
): Promise<"current" | "installed"> {
  if (await repository.getActiveSystemContentVersion() === BUNDLED_SYSTEM_CONTENT_VERSION) return "current";
  const response = await fetcher(BUNDLED_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error("系统句库暂时无法下载");
  let content: SystemContentPackage;
  try { content = validateSystemContentPackage(await response.json() as SystemContentPackage); }
  catch { throw new Error("系统内容包无效，已继续使用原有句库"); }
  if (content.version !== BUNDLED_SYSTEM_CONTENT_VERSION) throw new Error("系统内容包版本不一致，已继续使用原有句库");
  await repository.installSystemContentPackage(content);
  return "installed";
}
