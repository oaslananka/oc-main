import path from "node:path";
import { readJobUnsafe, writeResult } from "./action-state.mjs";
import { cleanOpenCodeOutput, runOpenCode } from "./opencode.mjs";
import {
  quarantineProjectControls,
  restoreProjectControls,
} from "./quarantine.mjs";

const job = await readJobUnsafe();
const quarantineDir = path.resolve(".oc-main-job/quarantine");
let quarantineState = null;

function errorTail(value, limit = 8000) {
  const text = String(value || "OpenCode failed");
  if (text.length <= limit) return text;
  return "[error output truncated to final " + limit + " characters]\n" +
    text.slice(-limit);
}

try {
  quarantineState = await quarantineProjectControls(
    job.repositoryDir,
    quarantineDir,
  );

  const result = await runOpenCode({
    repositoryDir: job.repositoryDir,
    homeDir: job.homeDir,
    opencodeBin: job.opencodeBin,
    model: job.model,
    agent: job.agent,
    prompt: job.prompt,
    timeoutMs: job.opencodeTimeoutMs,
  });

  await writeResult({
    runStatus: "success",
    output: cleanOpenCodeOutput(result.stdout) || "Completed.",
    error: "",
  });
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
