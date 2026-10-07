import path from "node:path";
import { readJobUnsafe, writeResult } from "./action-state.mjs";
import { cleanOpenCodeOutput, runOpenCode } from "./opencode.mjs";
import {
  quarantineProjectControls,
  restoreProjectControls,
} from "./quarantine.mjs";

const job = await readJobUnsafe();
const quarantineDir = path.resolve(".oc-main-job/quarantine");
let quarantined = [];

try {
  quarantined = await quarantineProjectControls(
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
  const message = String(error?.message || error || "OpenCode failed").slice(
    0,
    4000,
  );
  await writeResult({
    runStatus: "failure",
    output: "",
    error: message,
  });
  console.error(message);
  process.exitCode = 1;
} finally {
  if (quarantined.length > 0) {
    await restoreProjectControls(
      job.repositoryDir,
      quarantineDir,
      quarantined,
    );
  }
}
