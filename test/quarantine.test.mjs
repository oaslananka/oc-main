import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runProcess } from "../src/process.mjs";
import {
  quarantineProjectControls,
  restoreProjectControls,
} from "../src/quarantine.mjs";

test("quarantines project agent-control surfaces without dirtying tracked git state", async () => {
  await fs.rm(".tmp-quarantine-test", { recursive: true, force: true });
  await fs.mkdir(".tmp-quarantine-test/repo/.opencode/skills", { recursive: true });
  await fs.mkdir(".tmp-quarantine-test/repo/src", { recursive: true });
  await fs.mkdir(".tmp-quarantine-test/repo/nested", { recursive: true });
  await fs.writeFile(".tmp-quarantine-test/repo/opencode.json", "{\"permission\":{\"bash\":\"allow\"}}");
  await fs.writeFile(".tmp-quarantine-test/repo/.opencode/skills/evil.md", "malicious");
  await fs.writeFile(".tmp-quarantine-test/repo/AGENTS.md", "override control plane");
  await fs.writeFile(".tmp-quarantine-test/repo/nested/CLAUDE.md", "override");
  await fs.writeFile(".tmp-quarantine-test/repo/src/index.js", "export const ok = true;\n");

  const repositoryDir = path.resolve(".tmp-quarantine-test/repo");
  const quarantineDir = path.resolve(".tmp-quarantine-test/quarantine");
  await runProcess("git", ["init", "-q"], { cwd: repositoryDir });
  await runProcess("git", ["add", "."], { cwd: repositoryDir });
  await runProcess(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"],
    { cwd: repositoryDir },
  );

  const state = await quarantineProjectControls(repositoryDir, quarantineDir);
  assert.ok(state.entries.includes("opencode.json"));
  assert.ok(state.entries.includes(".opencode"));
  assert.ok(state.entries.includes("AGENTS.md"));
  assert.ok(state.entries.includes(path.join("nested", "CLAUDE.md")));
  assert.ok(state.tracked.includes("AGENTS.md"));
  assert.ok(state.tracked.includes(".opencode/skills/evil.md"));

  await assert.rejects(fs.access(".tmp-quarantine-test/repo/opencode.json"));
  await assert.rejects(fs.access(".tmp-quarantine-test/repo/.opencode"));
  await assert.rejects(fs.access(".tmp-quarantine-test/repo/AGENTS.md"));
  assert.equal(
    await fs.readFile(".tmp-quarantine-test/repo/src/index.js", "utf8"),
    "export const ok = true;\n",
  );

  const during = await runProcess("git", ["status", "--porcelain"], {
    cwd: repositoryDir,
  });
  assert.equal(during.stdout, "");

  await fs.writeFile(".tmp-quarantine-test/repo/opencode.json", "agent-created replacement");
  await restoreProjectControls(repositoryDir, quarantineDir, state);

  assert.equal(
    await fs.readFile(".tmp-quarantine-test/repo/opencode.json", "utf8"),
    "{\"permission\":{\"bash\":\"allow\"}}",
  );
  assert.equal(
    await fs.readFile(".tmp-quarantine-test/repo/.opencode/skills/evil.md", "utf8"),
    "malicious",
  );
  assert.equal(
    await fs.readFile(".tmp-quarantine-test/repo/AGENTS.md", "utf8"),
    "override control plane",
  );

  const after = await runProcess("git", ["status", "--porcelain"], {
    cwd: repositoryDir,
  });
  assert.equal(after.stdout, "");

  await fs.rm(".tmp-quarantine-test", { recursive: true, force: true });
});
