import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootFile = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const caddySiteBlock = (caddy: string, site: string) => {
  const match = caddy.match(
    new RegExp(`(?:^|\\n)${escapeRegExp(site)}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"),
  );
  expect(match, `missing Caddy site block for ${site}`).not.toBeNull();
  return match?.[1] ?? "";
};

const yamlSection = (yaml: string, name: string, indent = 0) => {
  const padding = " ".repeat(indent);
  const match = yaml.match(
    new RegExp(
      `(?:^|\\n)${padding}${escapeRegExp(name)}:\\s*\\n([\\s\\S]*?)(?=\\n${padding}\\S[^\\n]*:\\s*(?:\\n|$)|\\n\\S|$)`,
    ),
  );
  expect(match, `missing YAML section for ${name}`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("HTTPS reverse proxy", () => {
  it("serves the installable domain and preserves the legacy IP origin", () => {
    const caddy = rootFile("Caddyfile");
    const domainSite = caddySiteBlock(caddy, "phrase.archdemy.com");
    const legacyIpSite = caddySiteBlock(caddy, "http://43.153.204.17");

    expect(domainSite.match(/reverse_proxy phrase-bank:3000/g)).toHaveLength(1);
    expect(legacyIpSite.match(/reverse_proxy phrase-bank:3000/g)).toHaveLength(1);
  });

  it("makes Caddy the only public entry point and persists certificates", () => {
    const compose = rootFile("compose.yaml");
    const phraseBankService = yamlSection(compose, "phrase-bank", 2);
    const caddyService = yamlSection(compose, "caddy", 2);
    const volumes = yamlSection(compose, "volumes");

    expect(caddyService).toMatch(/^ {4}ports:\s*$/m);
    expect(caddyService).toMatch(/^ {6}- "80:80"\s*$/m);
    expect(caddyService).toMatch(/^ {6}- "443:443"\s*$/m);
    expect(caddyService).toMatch(/^ {4}volumes:\s*$/m);
    expect(caddyService).toMatch(/^ {6}- caddy_data:\/data\s*$/m);
    expect(caddyService).toMatch(/^ {6}- caddy_config:\/config\s*$/m);
    expect(phraseBankService).not.toMatch(/^ {4}ports:\s*$/m);
    expect(volumes).toMatch(/^ {2}caddy_data:\s*$/m);
    expect(volumes).toMatch(/^ {2}caddy_config:\s*$/m);
  });
});
