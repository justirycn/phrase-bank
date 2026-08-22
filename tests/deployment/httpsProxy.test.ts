import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootFile = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const caddySiteBlock = (caddy: string, site: string) => {
  const match = new RegExp(`(?:^|\\n)${escapeRegExp(site)}\\s*\\{`, "m").exec(caddy);
  expect(match, `missing Caddy site block for ${site}`).not.toBeNull();
  if (!match) return "";

  const openingBrace = caddy.indexOf("{", match.index);
  let depth = 1;
  for (let index = openingBrace + 1; index < caddy.length; index += 1) {
    if (caddy[index] === "{") depth += 1;
    if (caddy[index] === "}") depth -= 1;
    if (depth === 0) return caddy.slice(openingBrace + 1, index);
  }
  throw new Error(`unterminated Caddy site block for ${site}`);
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
  it("checks the public HTTPS endpoint during deployment", () => {
    const remoteScript = rootFile(".github/scripts/deploy-exact-sha.sh");
    const retryLoop = remoteScript.match(
      /for attempt in \$\(seq 1 "\$health_attempts"\); do\r?\n([\s\S]*?)\r?\ndone/,
    )?.[1] ?? "";
    const healthCheck = remoteScript.match(
      /deployment_is_healthy\(\) \{\r?\n([\s\S]*?)\r?\n\}/,
    )?.[1] ?? "";

    expect(remoteScript).not.toBe("");
    expect(healthCheck).toMatch(
      /curl --fail --silent --show-error --connect-timeout 2 --max-time 5 --resolve phrase\.archdemy\.com:443:127\.0\.0\.1 -o \/dev\/null -w '%\{http_code\}' https:\/\/phrase\.archdemy\.com\//,
    );
    expect(healthCheck).toMatch(
      /curl --fail --silent --show-error --connect-timeout 2 --max-time 5 --location -o \/dev\/null -w '%\{http_code\}' https:\/\/phrase\.archdemy\.com\//,
    );
    expect(healthCheck).toContain('[ "$local_status" = 200 ] && [ "$public_status" = 200 ]');
    expect(remoteScript.match(/if deployment_is_healthy; then/g)).toHaveLength(2);
    expect(retryLoop).toMatch(/if deployment_is_healthy; then[\s\S]*?exit 0/);
    expect(remoteScript).toMatch(
      /docker compose up -d[\s\S]*docker compose exec -T caddy caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile[\s\S]*docker compose exec -T caddy caddy reload --config \/etc\/caddy\/Caddyfile --adapter caddyfile[\s\S]*for attempt/,
    );
    expect(remoteScript).toContain("docker compose logs --tail=100 phrase-bank caddy");
    expect(remoteScript).not.toContain("http://127.0.0.1/");
  });

  it("serves the installable domain and preserves the legacy IP origin", () => {
    const caddy = rootFile("Caddyfile");
    const domainSite = caddySiteBlock(caddy, "phrase.archdemy.com");
    const legacyIpSite = caddySiteBlock(caddy, "http://43.153.204.17");

    expect(domainSite.match(/reverse_proxy (?:@document )?phrase-bank:3000/g)).toHaveLength(2);
    expect(domainSite).toMatch(/^\s*@manifest path \/manifest\.webmanifest\s*$/m);
    expect(domainSite).toMatch(
      /^\s*header @manifest >Content-Type application\/manifest\+json\s*$/m,
    );
    expect(domainSite).toMatch(/^\s*@document path \/\s*$/m);
    expect(domainSite).toMatch(
      /^\s*reverse_proxy @document phrase-bank:3000 \{\s*\n\s*header_down Cache-Control "no-store, no-cache, must-revalidate, max-age=0"\s*\n\s*\}\s*$/m,
    );
    expect(domainSite).not.toMatch(
      /^\s*header @manifest Content-Type application\/manifest\+json\s*$/m,
    );
    expect(legacyIpSite.match(/reverse_proxy (?:@document )?phrase-bank:3000/g)).toHaveLength(2);
    expect(legacyIpSite).toMatch(/^\s*@document path \/\s*$/m);
    expect(legacyIpSite).toMatch(
      /^\s*reverse_proxy @document phrase-bank:3000 \{\s*\n\s*header_down Cache-Control "no-store, no-cache, must-revalidate, max-age=0"\s*\n\s*\}\s*$/m,
    );
    expect(caddy.match(/reverse_proxy (?:@document )?phrase-bank:3000/g)).toHaveLength(4);
  });

  it("makes Caddy the only public entry point and persists certificates", () => {
    const compose = rootFile("compose.yaml");
    const phraseBankService = yamlSection(compose, "phrase-bank", 2);
    const caddyService = yamlSection(compose, "caddy", 2);
    const volumes = yamlSection(compose, "volumes");

    expect(caddyService).toMatch(/^ {4}image: caddy:2\.10\.2-alpine\s*$/m);
    expect(caddyService).toMatch(/^ {4}ports:\s*$/m);
    expect(caddyService).toMatch(/^ {6}- "80:80"\s*$/m);
    expect(caddyService).toMatch(/^ {6}- "443:443"\s*$/m);
    expect(caddyService).toMatch(/^ {4}volumes:\s*$/m);
    expect(caddyService).toMatch(/^ {6}- \.\/Caddyfile:\/etc\/caddy\/Caddyfile:ro\s*$/m);
    expect(caddyService).toMatch(/^ {6}- caddy_data:\/data\s*$/m);
    expect(caddyService).toMatch(/^ {6}- caddy_config:\/config\s*$/m);
    expect(phraseBankService).not.toMatch(/^ {4}ports:\s*$/m);
    expect(compose).not.toContain('"80:3000"');
    expect(volumes).toMatch(/^ {2}caddy_data:\s*$/m);
    expect(volumes).toMatch(/^ {2}caddy_config:\s*$/m);
  });
});
