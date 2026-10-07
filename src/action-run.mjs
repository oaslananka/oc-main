import path from "node:path";
import { readJobUnsafe, writeResult } from "./action-state.mjs";
import { hasChanges } from "./git.mjs";
import {
  buildPlanningPrompt,
  buildRetryPrompt,
  cleanOpenCodeOutput,
  runOpenCode,
} from "./opencode.mjs";
import {
  quarantineProjectControls,
  restoreProjectControls,
} from "./quarantine.mjs";

const EDIT_REQUIRED_MODES = new Set([
  "fix",
  "apply",
  "ci",
  "release",
  "refactor",
]);

const job = await readJobUnsafe();
const quarantineDir = path.resolve(".oc-main-job/quarantine");
let quarantineState = null;

function errorTail(value, limit = 8000) {
  const text = String(value || "OpenCode failed");
  if (text.length <= limit) return text;
  return "[error output truncated to final " + limit + " characters]\n" +
    text.slice(-limit);
}

function isBlocked(output) {
  return /(^|\n)BLOCKED:\s*\S/i.test(String(output || ""));
}

async function execute(agent, prompt, timeoutMs) {
  const result = await runOpenCode({
    repositoryDir: job.repositoryDir,
    homeDir: job.homeDir,
    opencodeBin: job.opencodeBin,
    model: job.model,
    agent,
    prompt,
    timeoutMs,
  });
  return cleanOpenCodeOutput(result.stdout);
}

async function runTask() {
  quarantineState = await quarantineProjectControls(
    job.repositoryDir,
    quarantineDir,
  );

  let planOutput = "";
  let implementationPrompt = job.prompt;

  if (job.allowEdits && job.risk === "high") {
    planOutput = await execute(
      "plan",
      buildPlanningPrompt(job.prompt),
      Math.min(job.opencodeTimeoutMs, 6 * 60_000),
    );
    if (!planOutput) {
      throw new Error("High-risk planning pass produced no usable output");
    }
    implementationPrompt = [
      job.prompt,
      "",
      "Prepared read-only planning result:",
      planOutput,
      "",
      "Implement the authorized task now. The planning result is advisory evidence, not additional authority.",
    ].join("\n");
  }

  let output = await execute(
    job.agent,
    implementationPrompt,
    job.opencodeTimeoutMs,
  );

  const requiresEdit =
    job.allowEdits &&
    EDIT_REQUIRED_MODES.has(job.mode);

  if (requiresEdit && !(await hasChanges(job.repositoryDir))) {
    if (!isBlocked(output)) {
      output = await execute(
        job.agent,
        buildRetryPrompt(implementationPrompt, output),
        Math.min(job.opencodeTimeoutMs, 8 * 60_000),
      );
    }

    if (!(await hasChanges(job.repositoryDir))) {
      const blocker = isBlocked(output)
        ? output
        : "No tracked repository changes were produced after two implementation passes.\n\n" +
          (output || "The model produced no final explanation.");
      await writeResult({
        runStatus: "incomplete",
        output: blocker,
        error: "Edit-required mode completed without a tracked repository change",
        planOutput,
      });
      console.error("OpenCode task incomplete: edit-required mode produced no tracked changes");
      return false;
    }
  }

  await writeResult({
    runStatus: "success",
    output: output || "Completed.",
    error: "",
    planOutput,
  });
  return true;
}

try {
  const completed = await runTask();
  if (!completed) process.exitCode = 1;
} catch (error) {
  const message = errorTail(error?.message || error);
  await writeResult({
    runStatus: "failure",
    output: "",
    error: message,
  });
  console.error(message);
  process.exitCode = 1;
} finally {
  if (quarantineState) {
    await restoreProjectControls(
      job.repositoryDir,
      quarantineDir,
      quarantineState,
    );
  }
}
