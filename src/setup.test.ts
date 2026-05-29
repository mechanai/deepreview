import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

const setupScript = path.resolve(import.meta.dirname, "setup.ts");

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `deepreview-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function run(cwd: string, args: string[] = []) {
  return Bun.spawnSync(["bun", "run", setupScript, ...args], {
    cwd,
    env: { ...process.env, XDG_CONFIG_HOME: cwd },
  });
}

describe("setup script", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(async () => {
    await Bun.$`rm -rf ${tempDir}`;
  });

  test("creates opencode.json with plugin when no config exists (global)", () => {
    const result = run(tempDir);
    expect(result.exitCode).toBe(0);

    const configPath = path.join(tempDir, "opencode", "opencode.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.plugin).toContain("@mechanai/deepreview");
  });

  test("creates symlinks for agents and commands (global)", () => {
    const result = run(tempDir);
    expect(result.exitCode).toBe(0);

    const agentsDir = path.join(tempDir, "opencode", "agents");
    const synthesizer = path.join(agentsDir, "deepreview-synthesizer.md");
    expect(existsSync(synthesizer)).toBe(true);
    expect(lstatSync(synthesizer).isSymbolicLink()).toBe(true);

    const commandsDir = path.join(tempDir, "opencode", "commands");
    const mainCmd = path.join(commandsDir, "deepreview.md");
    expect(existsSync(mainCmd)).toBe(true);
    expect(lstatSync(mainCmd).isSymbolicLink()).toBe(true);
  });

  test("--local installs into .opencode/ in cwd", () => {
    const result = run(tempDir, ["--local"]);
    expect(result.exitCode).toBe(0);

    const configPath = path.join(tempDir, "opencode.json");
    expect(existsSync(configPath)).toBe(true);

    const agentsDir = path.join(tempDir, ".opencode", "agents");
    expect(existsSync(path.join(agentsDir, "deepreview-synthesizer.md"))).toBe(true);
  });

  test("adds plugin to existing config without duplicating", () => {
    const configPath = path.join(tempDir, "opencode");
    mkdirSync(configPath, { recursive: true });
    writeFileSync(
      path.join(configPath, "opencode.json"),
      JSON.stringify({ plugin: ["other-plugin"] }, null, 2),
    );

    run(tempDir);
    const config = JSON.parse(readFileSync(path.join(configPath, "opencode.json"), "utf-8"));
    expect(config.plugin).toEqual(["other-plugin", "@mechanai/deepreview"]);

    // Run again — should not duplicate
    run(tempDir);
    const config2 = JSON.parse(readFileSync(path.join(configPath, "opencode.json"), "utf-8"));
    expect(config2.plugin).toEqual(["other-plugin", "@mechanai/deepreview"]);
  });

  test("preserves JSONC comments", () => {
    const configDir = path.join(tempDir, "opencode");
    mkdirSync(configDir, { recursive: true });
    const content = '{\n  // My comment\n  "provider": {}\n}\n';
    writeFileSync(path.join(configDir, "opencode.jsonc"), content);

    run(tempDir);
    const result = readFileSync(path.join(configDir, "opencode.jsonc"), "utf-8");
    expect(result).toContain("// My comment");
    expect(result).toContain("@mechanai/deepreview");
  });

  test("removes stale symlinks on upgrade", () => {
    const agentsDir = path.join(tempDir, "opencode", "agents");
    mkdirSync(agentsDir, { recursive: true });

    // Create a fake stale symlink that contains "deepreview" but doesn't exist in package
    symlinkSync("/nonexistent", path.join(agentsDir, "deepreview-old-agent.md"));

    run(tempDir);

    // Stale symlink should be removed
    expect(existsSync(path.join(agentsDir, "deepreview-old-agent.md"))).toBe(false);
    // But real agents should exist
    expect(existsSync(path.join(agentsDir, "deepreview-synthesizer.md"))).toBe(true);
  });

  test("handles dangling symlinks at dest gracefully", () => {
    const agentsDir = path.join(tempDir, "opencode", "agents");
    mkdirSync(agentsDir, { recursive: true });

    // Create a dangling symlink where a real agent should go
    symlinkSync("/nonexistent", path.join(agentsDir, "deepreview-synthesizer.md"));

    const result = run(tempDir);
    expect(result.exitCode).toBe(0);

    // Should have replaced the dangling symlink
    const dest = path.join(agentsDir, "deepreview-synthesizer.md");
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(existsSync(dest)).toBe(true); // Not dangling anymore
  });
});
