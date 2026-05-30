/**
 * Setup script for @mechanai/deepreview.
 *
 * Ensures the plugin is registered in opencode.json and symlinks agents/commands
 * into the OpenCode config directory.
 *
 * Usage:
 *   bunx @mechanai/deepreview/setup          # Install globally (~/.config/opencode/)
 *   bunx @mechanai/deepreview/setup --local   # Install into current project (.opencode/)
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";

const PACKAGE_NAME = "@mechanai/deepreview";
const local = process.argv.includes("--local");
const cwd = process.cwd();

const globalConfigDir = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  "opencode",
);
const targetDir = local ? path.join(cwd, ".opencode") : globalConfigDir;

// Resolve the package directory (where this script lives)
const packageDir = path.resolve(import.meta.dirname, "..");
const packageOpencode = path.join(packageDir, ".opencode");

function ensurePluginInConfig() {
  const configFiles = ["opencode.jsonc", "opencode.json"];
  const searchDir = local ? cwd : globalConfigDir;
  let configPath: string | undefined;

  for (const file of configFiles) {
    const candidate = path.join(searchDir, file);
    if (existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (configPath === undefined) {
    configPath = path.join(searchDir, "opencode.json");
    mkdirSync(searchDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ plugin: [PACKAGE_NAME] }, null, 2) + "\n");
    console.log(`Created ${configPath} with plugin entry.`);
    return;
  }

  const raw = readFileSync(configPath, "utf-8");

  // Check if plugin is already registered
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = parseJsonc(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    // oxlint-disable-next-line no-unsafe-type-assertion -- Why: validated above with type guards
    config = parsed as Record<string, unknown>;
  } catch {
    console.error(`Could not parse ${configPath}. Add the plugin manually:`);
    console.error(`  "plugin": ["${PACKAGE_NAME}"]`);
    process.exitCode = 1;
    return;
  }

  const pluginArray = Array.isArray(config.plugin) ? config.plugin : [];
  const plugins = pluginArray.filter((p): p is string => typeof p === "string");
  if (plugins.includes(PACKAGE_NAME)) {
    console.log(`Plugin already registered in ${configPath}.`);
    return;
  }

  // Use jsonc-parser to insert into the plugin array without stripping comments
  const formatting = { formattingOptions: { insertSpaces: true, tabSize: 2 } };
  const edits = Array.isArray(config.plugin)
    ? modify(raw, ["plugin", pluginArray.length], PACKAGE_NAME, formatting)
    : modify(raw, ["plugin"], [PACKAGE_NAME], formatting);

  writeFileSync(configPath, applyEdits(raw, edits));
  console.log(`Added "${PACKAGE_NAME}" to plugin array in ${configPath}.`);
}

function symlinkDirectory(kind: "agents" | "commands") {
  const sourceDir = path.join(packageOpencode, kind);
  if (!existsSync(sourceDir)) return;

  const destDir = path.join(targetDir, kind);
  mkdirSync(destDir, { recursive: true });

  const sourceFiles = new Set(readdirSync(sourceDir).filter((f) => f.endsWith(".md")));
  let created = 0;

  // Remove stale deepreview symlinks that no longer exist in the package
  for (const file of readdirSync(destDir)) {
    if (!file.startsWith("deepreview-") && !file.startsWith("_deepreview-")) continue;
    const dest = path.join(destDir, file);
    try {
      if (lstatSync(dest).isSymbolicLink() && !sourceFiles.has(file)) {
        unlinkSync(dest);
      }
    } catch (err: unknown) {
      if (err instanceof Error && !("code" in err && err.code === "ENOENT")) {
        console.warn(`Could not check ${dest}: ${err.message}`);
      }
    }
  }

  for (const file of sourceFiles) {
    const dest = path.join(destDir, file);
    const source = path.relative(destDir, path.join(sourceDir, file));

    try {
      // Use lstatSync to detect both regular files and dangling symlinks
      const stat = lstatSync(dest);
      if (!stat.isSymbolicLink()) {
        console.warn(`Skipping ${dest}: not a symlink (would overwrite regular file)`);
        continue;
      }
      unlinkSync(dest);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && err.code !== "ENOENT") {
        throw err;
      }
    }
    symlinkSync(source, dest);
    created++;
  }

  const label = local ? `.opencode/${kind}/` : path.join(targetDir, kind) + "/";
  console.log(`Linked ${created} ${kind} into ${label}`);
}

// Run
ensurePluginInConfig();
symlinkDirectory("agents");
symlinkDirectory("commands");
const scope = local ? "project" : "global";
console.log(`Done (${scope}). Run opencode to use /deepreview commands.`);
