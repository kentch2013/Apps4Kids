#!/usr/bin/env node
/**
 * Deterministic Contract & Scope Audit Gate (Zero External Dependencies)
 * ----------------------------------------------------------------------
 * Validates:
 *   1. Spec integrity: `<!-- END_OF_SPEC -->` sentinel and matching GitHub `repo`.
 *   2. Scope gate: Every file in `git diff --name-only <base>...HEAD` is in `allowed_files`.
 *   3. Test immutability gate: After the initial Red-state `test(...)` contract commit on
 *      this branch, no test files were modified in subsequent implementation commits.
 *
 * Usage:
 *   node scripts/audit-contract.js --spec "D:/aiprojects/geminiantigravity/01_specs/SPEC-42.md"
 *   node scripts/audit-contract.js --spec SPEC-42.md --base origin/main
 *   node scripts/audit-contract.js --ci --base origin/main   (test-immutability only when spec is in Drive)
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function parseArgs(argv) {
  const args = { spec: null, base: "origin/main", ci: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--spec" && argv[i + 1]) args.spec = argv[++i];
    else if (argv[i] === "--base" && argv[i + 1]) args.base = argv[++i];
    else if (argv[i] === "--ci") args.ci = true;
  }
  return args;
}

function git(cmdArgs) {
  return execFileSync("git", cmdArgs, { encoding: "utf8" }).trim();
}

function resolveBaseRef(preferredBase) {
  const candidates = [preferredBase, "origin/main", "main", "origin/master", "master"];
  for (const ref of candidates) {
    try {
      git(["rev-parse", "--verify", ref]);
      return ref;
    } catch (_) {
      // try next candidate
    }
  }
  throw new Error(`Could not resolve base git ref (tried: ${candidates.join(", ")})`);
}

function parseSimpleFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("Spec file is missing valid YAML frontmatter (--- ... ---).");

  const meta = { allowed_files: [], depends_on: [] };
  const lines = match[1].split(/\r?\n/);
  let currentListKey = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim()) continue;

    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      meta[currentListKey].push(stripQuotes(listMatch[1].trim()));
      continue;
    }

    const kvMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === "" || val === "[]") {
        currentListKey = key;
        if (!Array.isArray(meta[key])) meta[key] = [];
      } else if (val.startsWith("[") && val.endsWith("]")) {
        currentListKey = null;
        meta[key] = val
          .slice(1, -1)
          .split(",")
          .map((s) => stripQuotes(s.trim()))
          .filter(Boolean);
      } else {
        currentListKey = null;
        meta[key] = stripQuotes(val);
      }
    }
  }
  return meta;
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function globToRegExp(pattern) {
  const norm = pattern.replace(/\\/g, "/");
  let re = "^";
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i];
    if (ch === "*" && norm[i + 1] === "*") {
      re += ".*";
      i++;
      if (norm[i + 1] === "/") i++;
    } else if (ch === "*") {
      re += "[^/]*";
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  re += "$";
  return new RegExp(re);
}

function isAllowed(filePath, allowedPatterns) {
  const norm = filePath.replace(/\\/g, "/");
  return allowedPatterns.some((pat) => globToRegExp(pat).test(norm));
}

function isTestFile(filePath) {
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  return (
    /(^|\/)(__tests__|tests?)\//.test(norm) ||
    /\.(test|spec)\.[a-z0-9]+$/.test(norm) ||
    /(^|\/)test_[^/]+\.py$/.test(norm)
  );
}

function extractOwnerRepo(remoteUrl) {
  const m = remoteUrl.match(/[:/]([^/:]+\/[^/.]+?)(?:\.git)?$/);
  return m ? m[1].toLowerCase() : null;
}

function main() {
  const args = parseArgs(process.argv);
  const failures = [];
  const baseRef = resolveBaseRef(args.base);

  // 1. Spec & Scope Audit (when --spec is supplied)
  if (args.spec) {
    const specPath = path.resolve(args.spec);
    if (!fs.existsSync(specPath)) {
      console.error(`❌ Spec file not found: ${specPath}`);
      process.exit(1);
    }

    const rawSpec = fs.readFileSync(specPath, "utf8");
    if (!rawSpec.trimEnd().endsWith("<!-- END_OF_SPEC -->")) {
      failures.push("Spec is missing trailing `<!-- END_OF_SPEC -->` sentinel (possible incomplete Drive sync).");
    }

    const meta = parseSimpleFrontmatter(rawSpec);

    // Repo-match check against git remote origin (if configured)
    if (meta.repo) {
      try {
        const originUrl = git(["remote", "get-url", "origin"]);
        const actualRepo = extractOwnerRepo(originUrl);
        if (actualRepo && actualRepo !== String(meta.repo).toLowerCase()) {
          failures.push(`Repo mismatch: spec declares "${meta.repo}", but git origin is "${actualRepo}".`);
        }
      } catch (_) {
        // Local-only repo without origin remote; skip remote URL check.
      }
    }

    // Scope gate: check committed branch diff AND uncommitted tracked changes
    const committedDiff = git(["diff", "--name-only", `${baseRef}...HEAD`]);
    const workingDiff = git(["diff", "--name-only"]);
    const stagedDiff = git(["diff", "--cached", "--name-only"]);
    const changedFiles = Array.from(
      new Set(
        [committedDiff, workingDiff, stagedDiff]
          .join("\n")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );

    if (!meta.allowed_files || meta.allowed_files.length === 0) {
      failures.push("Spec `allowed_files` is empty; refusing to approve unbounded scope.");
    } else {
      const unauthorized = changedFiles.filter((f) => !isAllowed(f, meta.allowed_files));
      if (unauthorized.length > 0) {
        failures.push(
          `Unauthorized files modified outside allowed_files:\n  - ${unauthorized.join("\n  - ")}`
        );
      }
    }
  } else if (!args.ci) {
    console.error("❌ Missing required argument: --spec <path/to/SPEC-N.md> (or pass --ci).");
    process.exit(1);
  }

  // 2. Test Immutability Gate
  // Find the first `test:` or `test(#N):` commit on this branch since baseRef.
  // Any subsequent commit (or unstaged/staged edit) touching a test file fails the audit.
  const logRaw = git(["log", "--reverse", "--format=%H\t%s", `${baseRef}..HEAD`]);
  const commits = logRaw
    ? logRaw.split(/\r?\n/).map((line) => {
        const [sha, ...rest] = line.split("\t");
        return { sha, subject: rest.join("\t") };
      })
    : [];

  const contractCommitIdx = commits.findIndex((c) => /^test(\([^)]+\))?:/i.test(c.subject));
  if (contractCommitIdx !== -1) {
    const contractSha = commits[contractCommitIdx].sha;
    const postContractCommitted = git(["diff", "--name-only", `${contractSha}..HEAD`]);
    const workingNow = git(["diff", "--name-only"]);
    const stagedNow = git(["diff", "--cached", "--name-only"]);
    const postContractFiles = Array.from(
      new Set(
        [postContractCommitted, workingNow, stagedNow]
          .join("\n")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );

    const mutatedTests = postContractFiles.filter(isTestFile);
    if (mutatedTests.length > 0) {
      failures.push(
        `Test immutability violated after contract commit ${contractSha.slice(0, 7)}:\n  - ${mutatedTests.join("\n  - ")}`
      );
    }
  }

  if (failures.length > 0) {
    console.error("❌ Contract & Scope Audit FAILED:");
    for (const msg of failures) console.error(`  * ${msg}`);
    process.exit(1);
  }

  console.log("✅ Contract & Scope Audit Passed: Scope respected and test files remained 100% immutable.");
}

main();
