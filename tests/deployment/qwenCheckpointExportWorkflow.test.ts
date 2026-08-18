// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = () => readFileSync(resolve(process.cwd(), ".github/workflows/qwen-checkpoint-export.yml"), "utf8");

describe("Qwen checkpoint export workflow", () => {
  it("manually exports exactly one requested checkpoint with a one-day lifetime", () => {
    const source = workflow();
    expect(source).toContain("workflow_dispatch:");
    expect(source).toMatch(/version:\s*\r?\n\s+description:.*\r?\n\s+required: true\r?\n\s+default: 2026\.08\.3/);
    expect(source).toMatch(/request_id:\s*\r?\n\s+description:.*\r?\n\s+required: true\r?\n\s+type: string/);
    expect(source).toMatch(/permissions:\r?\n\s+contents: read/);
    expect(source).toContain("run-name: Export Qwen checkpoint ${{ inputs.version }} (${{ inputs.request_id }})");
    expect(source).toContain("qwen-checkpoint-${{ inputs.version }}-${{ inputs.request_id }}");
    expect(source).toContain("retention-days: 1");
    expect(source).toContain("if-no-files-found: error");

    const scpLines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("scp "));
    expect(scpLines).toHaveLength(1);
    expect(scpLines[0]).toContain("/opt/phrase-bank/.content-agent/checkpoint-$CONTENT_VERSION.json");
    expect(scpLines[0]).not.toMatch(/(?:^|\s)(?:--recursive|-[A-Za-z]*r[A-Za-z]*)(?:\s|$)/);
  });

  it("uses only the three SSH secrets and always removes the private key", () => {
    const source = workflow();
    const secretNames = [...source.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    expect([...new Set(secretNames)].sort()).toEqual(["TENCENT_HOST", "TENCENT_SSH_KEY", "TENCENT_USER"]);
    expect(source).not.toMatch(/DASHSCOPE|\/etc\/phrase-bank|qwen-content\.env/i);
    expect(source).toMatch(/name: Remove SSH key\r?\n\s+if: always\(\)\r?\n\s+run: rm -f ~\/\.ssh\/tencent_qwen/);
  });

  it("validates hostile version and correlation input before SSH setup without shell interpolation", () => {
    const source = workflow();
    const validationPosition = source.indexOf("name: Validate content version");
    const sshPosition = source.indexOf("name: Configure SSH");
    expect(validationPosition).toBeGreaterThan(-1);
    expect(validationPosition).toBeLessThan(sshPosition);
    expect(source).toContain("REQUESTED_VERSION: ${{ inputs.version }}");
    expect(source).toContain("REQUEST_ID: ${{ inputs.request_id }}");
    expect(source).toContain("^([0-9]{4})\\.([0-9]{2})\\.([0-9]+)$");
    expect(source).toContain("^[0-9a-f]{32}$");
    expect(source).toContain("CONTENT_VERSION=$REQUESTED_VERSION");

    const runBodies = [...source.matchAll(/run:\s*\|\r?\n((?:\s{10}.*(?:\r?\n|$))*)/g)].map((match) => match[1]);
    expect(runBodies.length).toBeGreaterThan(0);
    expect(runBodies.every((body) => !body.includes("${{ inputs.version }}"))).toBe(true);
    expect(source.match(/\$\{\{ inputs\.version \}\}/g)).toHaveLength(3);
    expect(source.match(/\$\{\{ inputs\.request_id \}\}/g)).toHaveLength(3);
  });
});
