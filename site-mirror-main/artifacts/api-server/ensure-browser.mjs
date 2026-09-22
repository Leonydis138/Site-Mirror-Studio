#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";

console.log("");
console.log("==============================================");
console.log(" Puppeteer Chrome Verification");
console.log("==============================================");
console.log("");

var chromePath = "";

try {
  chromePath = puppeteer.executablePath();
} catch (error) {
  console.error("Unable to determine Puppeteer Chrome path.");
  console.error(String(error));
  process.exit(1);
}

console.log("Puppeteer Chrome path:");
console.log(chromePath);
console.log("");

function chromeExists() {
  try {
    return fs.existsSync(chromePath);
  } catch (error) {
    return false;
  }
}

if (chromeExists()) {
  console.log("Chrome is already installed.");
  console.log("");
  console.log("Puppeteer Chrome: READY");
  console.log("");
  process.exit(0);
}

console.log("Chrome is not installed.");
console.log("");
console.log("Installing Puppeteer Chrome...");
console.log("");

try {
  execFileSync(
    "pnpm",
    [
      "exec",
      "puppeteer",
      "browsers",
      "install",
      "chrome"
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PUPPETEER_SKIP_DOWNLOAD: "false"
      }
    }
  );
} catch (error) {
  console.error("");
  console.error("Puppeteer Chrome installation failed.");
  console.error("");
  console.error(String(error));
  console.error("");
  process.exit(1);
}

console.log("");
console.log("Checking Chrome installation...");
console.log("");

try {
  chromePath = puppeteer.executablePath();
} catch (error) {
  console.error("Unable to determine Chrome path after installation.");
  console.error(String(error));
  process.exit(1);
}

console.log("Chrome path:");
console.log(chromePath);
console.log("");

if (!chromeExists()) {
  console.error("ERROR: Chrome executable was not found.");
  console.error("");
  console.error(chromePath);
  console.error("");
  process.exit(1);
}

console.log("Chrome executable found.");
console.log("");
console.log("Puppeteer Chrome: READY");
console.log("");
