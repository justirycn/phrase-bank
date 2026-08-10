import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSystemContent } from "./content-agent/generator";
import { inspectSystemContent } from "./content-agent/qualityGate";

const content = generateSystemContent();
const report = inspectSystemContent(content);
if (report.errors.length) throw new Error(report.errors.join("\n"));
const directory = resolve(process.cwd(), "public/content");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, `system-content-${content.version}.json`), `${JSON.stringify(content, null, 2)}\n`, "utf8");
console.log(`Published ${report.coreCount} core blocks and ${report.totalCount} phrases.`);
