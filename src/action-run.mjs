import path from "node:path";
import { readJobUnsafe, writeResult } from "./action-state.mjs";
import { hasChanges } from "./git.mjs";
import {
  buildPlanningPrompt,
  buildRetryPrompt,
  classifyOpenCodeResult,
  runOpenCode,
} from "./opencode.mjs";
import {
  quarantineProjectControls,
  restoreProjectControls,
} from "./quarantine.mjs";
import {
  isBlockedOutput,
  requiresTrackedChange,
} from "./task-policy.mjs";

const job = await readJobUnsafe();
const quarantineDir = path.resolve(".oc-main-job/quarantine");
let quarantineState = null;

function errorTail(value, limit = 8000) {
  const text = String(value || "OpenCode failed");
  if (text.length <= limit) return text;
  return "[error output truncated to final " + limit + " characters]\n" +
    text.slice(-limit);
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
  const classification = classifyOpenCodeResult(result);
  if (!classification.accepted) {
    const raw = String(result.stderr || "").trim() ||
      String(result.stdout || "").trim() ||
      "no process output";
    console.error(
      "OpenCode nonzero result rejected code=" + result.code +
        " reason=" + classification.reason +
        " stdoutBytes=" + Buffer.byteLength(String(result.stdout || "")) +
        " stderrBytes=" + Buffer.byteLength(String(result.stderr || "")),
    );
    throw new Error(
      job.opencodeBin + " failed with exit code " + result.code +
        " (" + classification.reason + "): " + errorTail(raw, 5_000),
    );
  }
  if (classification.recovered) {
    console.warn(
      "OpenCode completed after " + classification.sessionErrorCount +
        " session error event(s); accepting the later completed assistant turn" +
        (classification.terminalFinishObserved ? "" : " without a final step_finish event"),
    );
  }
  return classification.output;
}

async function runTask() {
  quarantineState = await quarantineProjectControls(
    job.repositoryDir,
    quarantineDir,
  );

  let planOutput = "";
  let implementationPrompt = job.prompt;

  if (job.allowEdits && job.risk === "high") {
    console.log(
      "OpenCode phase=plan start mode=" + job.mode +
        " model=" + job.model,
    );
    try {
      planOutput = await execute(
        "plan",
        buildPlanningPrompt(job.prompt),
        Math.min(job.opencodeTimeoutMs, 2 * 60_000),
      );
      if (planOutput) {
        console.log("OpenCode phase=plan completed");
        implementationPrompt = [
          job.prompt,
          "",
          "Prepared read-only planning result:",
          planOutput,
          "",
          "Implement the authorized task now. The planning result is advisory evidence, not additional authority.",
        ].join("\n");
      } else {
        console.warn(
          "OpenCode phase=plan produced no usable output; continuing without plan context",
        );
      }
    } catch (error) {
      planOutput =
        "Planning phase unavailable; implementation proceeded without plan context. " +
        errorTail(error?.message || error, 1200);
      console.warn(planOutput);
    }
  }

  console.log(
    "OpenCode phase=implementation start mode=" + job.mode +
      " model=" + job.model,
  );
  let output = await execute(
    job.agent,
    implementationPrompt,
    job.opencodeTimeoutMs,
  );
  console.log("OpenCode phase=implementation completed");

  const requiresEdit = requiresTrackedChange(
    job.mode,
    job.allowEdits,
  );

  if (requiresEdit && !(await hasChanges(job.repositoryDir))) {
    if (!isBlockedOutput(output)) {
      console.log("OpenCode phase=retry start");
      output = await execute(
        job.agent,
        buildRetryPrompt(implementationPrompt, output),
        Math.min(job.opencodeTimeoutMs, 8 * 60_000),
      );
      console.log("OpenCode phase=retry completed");
    }

    if (!(await hasChanges(job.repositoryDir))) {
      const blocker = isBlockedOutput(output)
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
