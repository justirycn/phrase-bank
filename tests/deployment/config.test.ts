import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const text = (path: string) => readFile(path, "utf8");

describe("deployment configuration", () => {
  it("builds with Node 22 and runs as a non-root user", async () => {
    const dockerfile = await text("Dockerfile");
    expect(dockerfile).toMatch(/FROM node:22-bookworm-slim/);
    expect(dockerfile).toMatch(/RUN npm test/);
    expect(dockerfile).toMatch(/RUN npm run build/);
    expect(dockerfile).toMatch(/USER node/);
    expect(dockerfile).toMatch(/EXPOSE 3000/);
  });

  it("publishes HTTP and HTTPS through Caddy and defines app restart and health behavior", async () => {
    const compose = await text("compose.yaml");
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
    expect(compose).not.toContain('"80:3000"');
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("http://127.0.0.1:3000/");
  });

  it("tests main before deploying with the three approved secrets", async () => {
    const workflow = await text(".github/workflows/deploy.yml");
    const remoteScript = await text(".github/scripts/deploy-exact-sha.sh");
    expect(workflow).toContain("branches: [main]");
    expect(workflow.indexOf("npm test")).toBeLessThan(workflow.indexOf("deploy:"));
    for (const name of ["TENCENT_HOST", "TENCENT_USER", "TENCENT_SSH_KEY"]) expect(workflow).toContain(`secrets.${name}`);
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).toContain('bash -se" < .github/scripts/deploy-exact-sha.sh');
    expect(remoteScript.indexOf("docker compose build")).toBeLessThan(remoteScript.indexOf("docker compose up -d"));
    expect(remoteScript).not.toContain("sudo docker");
    expect(remoteScript).toContain("https://phrase.archdemy.com/");
    expect(remoteScript).toContain("--resolve phrase.archdemy.com:443:127.0.0.1");
  });
});
