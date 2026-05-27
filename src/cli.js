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
  try {
    return execSync("git config --global core.excludesFile", { encoding: "utf8" }).trim();
  } catch {
    return path.join(os.homedir(), ".config", "git", "ignore");
  }
}

function install(flags) {
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

  if (flags.has("--gitignore-global")) {
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

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-"));
const flags = new Set(args.filter((a) => a.startsWith("-")));

if (command === "install") {
  install(flags);
} else if (command === "uninstall") {
  uninstall();
} else {
  console.log("Usage: deepreview install [--gitignore-global]");
  console.log("       deepreview uninstall");
  process.exit(1);
}
