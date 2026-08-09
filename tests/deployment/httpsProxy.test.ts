import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootFile = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");

describe("HTTPS reverse proxy", () => {
  it("serves the installable domain and preserves the legacy IP origin", () => {
    const caddy = rootFile("Caddyfile");
    expect(caddy).toContain("phrase.archdemy.com");
    expect(caddy).toContain("http://43.153.204.17");
    expect(caddy.match(/reverse_proxy phrase-bank:3000/g)).toHaveLength(2);
  });

  it("makes Caddy the only public entry point and persists certificates", () => {
    const compose = rootFile("compose.yaml");
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
    expect(compose).toContain("caddy_data:/data");
    expect(compose).toContain("caddy_config:/config");
    expect(compose).not.toContain('"80:3000"');
  });
});
