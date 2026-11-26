#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const errors = [];

function checkFileExists(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`Missing required file: ${relPath}`);
    return null;
  }
  return fs.readFileSync(fullPath, "utf8");
}

// 1. Confirm Issue #1 curriculum baseline is present on main
checkFileExists("preschool-curriculum/schema.json");
checkFileExists("scripts/validate-curriculum.js");

// 2. Verify root MIT LICENSE
const licenseText = checkFileExists("LICENSE");
if (licenseText !== null) {
  if (!licenseText.includes("MIT License")) {
    errors.push("LICENSE must declare 'MIT License'.");
  }
  if (!licenseText.includes("Permission is hereby granted, free of charge")) {
    errors.push("LICENSE must contain standard MIT License grant text.");
  }
}

// 3. Verify docs/ASSETS_LICENSE_POLICY.md
const policyText = checkFileExists("docs/ASSETS_LICENSE_POLICY.md");
if (policyText !== null) {
  const requiredTokens = [
    "MIT",
    "Apache-2.0",
    "BSD",
    "CC0",
    "GPL",
    "AGPL",
    "CC-BY-SA",
    "assets/ATTRIBUTION.json",
  ];
  for (const token of requiredTokens) {
    if (!policyText.includes(token)) {
      errors.push(`docs/ASSETS_LICENSE_POLICY.md missing required token: ${token}`);
    }
  }
  if (!/100%\s+offline/i.test(policyText)) {
    errors.push("docs/ASSETS_LICENSE_POLICY.md must document the 100% offline consumer runtime boundary.");
  }
  if (!/\bNC\b/.test(policyText) || !/\bND\b/.test(policyText)) {
    errors.push("docs/ASSETS_LICENSE_POLICY.md must explicitly disallow Creative Commons NC and ND terms.");
  }
}

if (errors.length > 0) {
  console.error("LICENSE POLICY VALIDATION FAILED:");
  for (const err of errors) {
    console.error(` - ${err}`);
  }
  process.exit(1);
}

console.log("LICENSE POLICY VALIDATION PASSED | Baseline curriculum, MIT LICENSE, and docs/ASSETS_LICENSE_POLICY.md verified.");
