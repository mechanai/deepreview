#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");

function install() {
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

const command = process.argv[2];

if (command === "install") {
  install();
} else if (command === "uninstall") {
  uninstall();
} else {
  console.log("Usage: deepreview <install|uninstall>");
  process.exit(1);
}
