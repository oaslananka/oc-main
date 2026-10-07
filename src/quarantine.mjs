import fs from "node:fs/promises";
import path from "node:path";

const CONTROL_DIRECTORIES = new Set([".opencode", ".claude", ".agents"]);
const CONTROL_FILES = new Set([
  "opencode.json",
  "opencode.jsonc",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
]);

async function walk(root, current = root, found = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);

    if (entry.isDirectory() && CONTROL_DIRECTORIES.has(entry.name)) {
      found.push(relative);
      continue;
    }
    if (CONTROL_FILES.has(entry.name)) {
      found.push(relative);
      continue;
    }

    if (entry.isDirectory()) {
      await walk(root, absolute, found);
    }
  }
  return found;
}

function safeRelative(value) {
  if (
    !value ||
    path.isAbsolute(value) ||
    value === ".." ||
    value.startsWith(".." + path.sep)
  ) {
    throw new Error("Unsafe quarantine path");
  }
  return value;
}

export async function quarantineProjectControls(repositoryDir, quarantineDir) {
  await fs.rm(quarantineDir, { recursive: true, force: true });
  await fs.mkdir(quarantineDir, { recursive: true });

  const entries = await walk(repositoryDir);
  entries.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);

  for (const relativeValue of entries) {
    const relative = safeRelative(relativeValue);
    const source = path.join(repositoryDir, relative);
    const destination = path.join(quarantineDir, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(source, destination);
  }

  return entries;
}

export async function restoreProjectControls(
  repositoryDir,
  quarantineDir,
  entries,
) {
  for (const relativeValue of [...entries].reverse()) {
    const relative = safeRelative(relativeValue);
    const source = path.join(quarantineDir, relative);
    const destination = path.join(repositoryDir, relative);

    await fs.rm(destination, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(source, destination);
  }

  await fs.rm(quarantineDir, { recursive: true, force: true });
}

export const quarantinedControlNames = {
  directories: [...CONTROL_DIRECTORIES],
  files: [...CONTROL_FILES],
};
