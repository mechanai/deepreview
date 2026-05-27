#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const GITIGNORE_ENTRY = ".ai/deepreview/";

function ensureGitignore(filepath) {
  let content = "";
  if (fs.existsSync(filepath)) {
    content = fs.readFileSync(filepath, "utf8");
    if (content.split("\n").some((line) => line.trim() === GITIGNORE_ENTRY)) {
      return false;
    }
  }
  const newline = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(filepath, content + newline + GITIGNORE_ENTRY + "\n");
  return true;
}

function globalGitignorePath() {
  const { execSync } = require("node:child_process");
  let filepath;
  try {
    filepath = execSync("git config --global core.excludesFile", { encoding: "utf8" }).trim();
  } catch {
    filepath = path.join(os.homedir(), ".config", "git", "ignore");
  }
  if (filepath.startsWith("~/")) {
    filepath = path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

function install(options) {
  const agentsSrc = path.join(PACKAGE_ROOT, "agents");
  const commandsSrc = path.join(PACKAGE_ROOT, "commands");
  const agentsDest = path.join(CONFIG_DIR, "agents");
  const commandsDest = path.join(CONFIG_DIR, "commands");

  fs.mkdirSync(agentsDest, { recursive: true });
  fs.mkdirSync(commandsDest, { recursive: true });

  let count = 0;

  for (const file of fs.readdirSync(agentsSrc)) {
    if (!file.endsWith(".md")) continue;
    fs.copyFileSync(path.join(agentsSrc, file), path.join(agentsDest, file));
    count++;
  }

  for (const file of fs.readdirSync(commandsSrc)) {
    if (!file.endsWith(".md")) continue;
    fs.copyFileSync(path.join(commandsSrc, file), path.join(commandsDest, file));
    count++;
  }

  console.log(`Installed ${count} files to ${CONFIG_DIR}`);

  if (options["gitignore-global"]) {
    const ignorePath = globalGitignorePath();
    fs.mkdirSync(path.dirname(ignorePath), { recursive: true });
    if (ensureGitignore(ignorePath)) {
      console.log(`Added ${GITIGNORE_ENTRY} to ${ignorePath}`);
    }
  } else {
    const localIgnore = path.join(process.cwd(), ".gitignore");
    if (ensureGitignore(localIgnore)) {
      console.log(`Added ${GITIGNORE_ENTRY} to .gitignore`);
    }
  }
}

function uninstall() {
  const agentsDest = path.join(CONFIG_DIR, "agents");
  const commandsDest = path.join(CONFIG_DIR, "commands");
  let count = 0;

  for (const dir of [agentsDest, commandsDest]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.startsWith("deepreview") || !file.endsWith(".md")) continue;
      fs.unlinkSync(path.join(dir, file));
      count++;
    }
  }

  console.log(`Removed ${count} files from ${CONFIG_DIR}`);
}

const { parseArgs } = require("node:util");

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      "gitignore-global": { type: "boolean", default: false },
    },
  });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const command = parsed.positionals[0];

if (command === "install") {
  install(parsed.values);
} else if (command === "uninstall") {
  uninstall();
} else {
  console.log("Usage: deepreview install [--gitignore-global]");
  console.log("       deepreview uninstall");
  process.exit(1);
}
