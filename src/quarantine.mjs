import path from "node:path";
import { runProcess } from "./process.mjs";

const CONTROL_DIRECTORIES = new Set([".opencode", ".claude", ".agents"]);
const CONTROL_FILES = new Set([
  "opencode.json",
  "opencode.jsonc",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
]);

function safeRelative(value) {
  const normalized = path.normalize(String(value || ""));
  if (
    !normalized ||
    normalized === "." ||
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(".." + path.sep) ||
    normalized.includes("\0")
  ) {
    throw new Error("Unsafe quarantine path");
  }
  return normalized;
}

function inside(root, relativeValue) {
  const base = path.resolve(root);
  const relative = safeRelative(relativeValue);
  const absolute = path.resolve(base, relative);
  if (!absolute.startsWith(base + path.sep)) {
    throw new Error("Quarantine path escaped its root");
  }
  return absolute;
}

async function listGitPaths(repositoryDir) {
  const visible = await runProcess(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repositoryDir, timeoutMs: 60_000, maxOutputBytes: 4_000_000 },
  );
  const ignored = await runProcess(
    "git",
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"],
    { cwd: repositoryDir, timeoutMs: 60_000, maxOutputBytes: 4_000_000 },
  );
  return [...new Set((visible.stdout + ignored.stdout).split("\0").filter(Boolean))];
}

function controlCandidate(relativeValue) {
  const relative = safeRelative(relativeValue);
  const segments = relative.split(path.sep);
  const controlDirectoryIndex = segments.findIndex((segment) =>
    CONTROL_DIRECTORIES.has(segment),
  );
  if (controlDirectoryIndex >= 0) {
    return segments.slice(0, controlDirectoryIndex + 1).join(path.sep);
  }
  if (CONTROL_FILES.has(path.basename(relative))) return relative;
  return null;
}

function collapseCandidates(values) {
  const sorted = [...new Set(values)]
    .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
  const result = [];
  for (const candidate of sorted) {
    if (result.some((parent) => candidate.startsWith(parent + path.sep))) {
      continue;
    }
    result.push(candidate);
  }
  return result;
}

async function removeTree(target) {
  await runProcess("rm", ["-rf", "--", target], { timeoutMs: 60_000 });
}

async function makeDirectory(target) {
  await runProcess("mkdir", ["-p", "--", target], { timeoutMs: 60_000 });
}

async function movePath(source, destination) {
  await makeDirectory(path.dirname(destination));
  await runProcess("mv", ["--", source, destination], { timeoutMs: 60_000 });
}

export async function quarantineProjectControls(repositoryDir, quarantineDir) {
  const repositoryRoot = path.resolve(repositoryDir);
  const quarantineRoot = path.resolve(quarantineDir);
  if (
    quarantineRoot === repositoryRoot ||
    quarantineRoot.startsWith(repositoryRoot + path.sep)
  ) {
    throw new Error("Quarantine directory must be outside the repository");
  }

  const candidates = collapseCandidates(
    (await listGitPaths(repositoryRoot))
      .map(controlCandidate)
      .filter(Boolean),
  );

  await removeTree(quarantineRoot);
  await makeDirectory(quarantineRoot);

  for (const relative of candidates) {
    await movePath(
      inside(repositoryRoot, relative),
      inside(quarantineRoot, relative),
    );
  }

  return candidates;
}

export async function restoreProjectControls(
  repositoryDir,
  quarantineDir,
  entries,
) {
  const repositoryRoot = path.resolve(repositoryDir);
  const quarantineRoot = path.resolve(quarantineDir);

  for (const relative of [...entries].reverse()) {
    const source = inside(quarantineRoot, relative);
    const destination = inside(repositoryRoot, relative);
    await removeTree(destination);
    await movePath(source, destination);
  }

  await removeTree(quarantineRoot);
}

export const quarantinedControlNames = {
  directories: [...CONTROL_DIRECTORIES],
  files: [...CONTROL_FILES],
};
