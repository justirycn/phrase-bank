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

  it("maps HTTP port 80 and defines restart and health behavior", async () => {
    const compose = await text("compose.yaml");
    expect(compose).toContain('"80:3000"');
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("http://127.0.0.1:3000/");
  });

  it("tests main before deploying with the three approved secrets", async () => {
    const workflow = await text(".github/workflows/deploy.yml");
    expect(workflow).toContain("branches: [main]");
    expect(workflow.indexOf("npm test")).toBeLessThan(workflow.indexOf("deploy:"));
    for (const name of ["TENCENT_HOST", "TENCENT_USER", "TENCENT_SSH_KEY"]) expect(workflow).toContain(`secrets.${name}`);
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow.indexOf("docker compose build")).toBeLessThan(workflow.indexOf("docker compose up -d"));
    expect(workflow).not.toContain("sudo docker");
    expect(workflow).toContain("http://127.0.0.1/");
  });
});
