#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WORKTREE_ROOT = "/private/tmp/fx-worktrees";
const DEFAULT_BASE_REF = "origin/main";
const AGENT_STATUS_TEMPLATE = "templates/AGENT_STATUS.md";

function main() {
  const [taskName, requestedBaseRef] = process.argv.slice(2);

  if (taskName == null || taskName === "--help" || taskName === "-h") {
    printUsage(taskName == null ? 1 : 0);
  }

  const baseRef = requestedBaseRef ?? DEFAULT_BASE_REF;
  const slug = slugify(taskName);

  if (slug === "") {
    fail(`Could not derive a worktree slug from "${taskName}".`);
  }

  const branch = `codex/${slug}`;
  const worktreePath = join(WORKTREE_ROOT, slug);
  const workspacePath = join(worktreePath, `fx-${slug}.code-workspace`);

  if (requestedBaseRef == null) {
    run("git", ["fetch", "origin", "main"]);
  }

  ensureGitRef(baseRef, `${baseRef}^{commit}`, `Base ref does not exist: ${baseRef}`);
  ensureGitRefMissing(branch);
  ensurePathMissing(worktreePath);

  mkdirSync(WORKTREE_ROOT, { recursive: true });

  run("git", ["worktree", "add", "-b", branch, worktreePath, baseRef]);

  addLocalExcludes(worktreePath, ["/AGENT_STATUS.md", "*.code-workspace"]);
  writeFileSync(join(worktreePath, "AGENT_STATUS.md"), agentStatus(branch, worktreePath));
  writeFileSync(workspacePath, workspaceFile(worktreePath));
  installDependencies(worktreePath);

  console.log(`Created worktree for ${branch}`);
  console.log(`Branch: ${branch}`);
  console.log(`Path: ${worktreePath}`);
  console.log(`Workspace: ${workspacePath}`);
  console.log("Dependencies: installed with pnpm install --frozen-lockfile");
  console.log("Project typecheck: pnpm typecheck");
  console.log(`Open in VS Code: code ${workspacePath}`);
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureGitRef(label, ref, message) {
  const result = git(["rev-parse", "--verify", "--quiet", ref]);

  if (result.status !== 0) {
    fail(message ?? `Git ref does not exist: ${label}`);
  }
}

function ensureGitRefMissing(branch) {
  const result = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);

  if (result.status === 0) {
    fail(`Branch already exists: ${branch}`);
  }
}

function ensurePathMissing(path) {
  if (existsSync(path)) {
    fail(`Worktree path already exists: ${path}`);
  }
}

function addLocalExcludes(worktreePath, entries) {
  const result = git(["-C", worktreePath, "rev-parse", "--git-path", "info/exclude"]);

  if (result.status !== 0) {
    fail(`Could not find local Git exclude file for ${worktreePath}.`);
  }

  const excludePath = result.stdout.trim();
  const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const existingLines = new Set(existing.split(/\r?\n/));
  const missing = entries.filter((entry) => !existingLines.has(entry));

  if (missing.length > 0) {
    appendFileSync(
      excludePath,
      `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${missing.join("\n")}\n`,
    );
  }
}

function agentStatus(branch, worktreePath) {
  if (!existsSync(AGENT_STATUS_TEMPLATE)) {
    fail(`Missing agent status template: ${AGENT_STATUS_TEMPLATE}`);
  }

  return readFileSync(AGENT_STATUS_TEMPLATE, "utf8")
    .replaceAll("{{branch}}", branch)
    .replaceAll("{{worktree}}", worktreePath);
}

function workspaceFile(worktreePath) {
  return `${JSON.stringify(
    {
      folders: [{ path: resolve(worktreePath) }],
      settings: {
        "terminal.integrated.cwd": "${workspaceFolder}",
        "terminal.integrated.splitCwd": "workspaceRoot",
        "window.title": "${rootName} - ${activeRepositoryBranchName}",
      },
    },
    null,
    2,
  )}
`;
}

function git(args) {
  return spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
}

function installDependencies(worktreePath) {
  const result = run("pnpm", ["install", "--frozen-lockfile"], { cwd: worktreePath, check: false });

  if (result.status !== 0) {
    fail(`Created worktree, but dependency installation failed.

Worktree: ${worktreePath}
Recovery:
  cd ${worktreePath}
  pnpm install --frozen-lockfile`);
  }
}

function run(command, args, options = {}) {
  const { check = true, cwd } = options;
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" });

  if (check && result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed.`);
  }

  return result;
}

function printUsage(exitCode) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`Usage: pnpm worktree:create -- <short-task> [base-ref]

Creates a PR-ready worktree under ${WORKTREE_ROOT}.
When [base-ref] is omitted, fetches origin main and uses origin/main.
Installs dependencies in the new worktree with pnpm install --frozen-lockfile.

Example:
  pnpm worktree:create -- trace-fork-context`);
  process.exit(exitCode);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
