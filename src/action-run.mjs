import { readJobUnsafe, writeResult } from "./action-state.mjs";
import { cleanOpenCodeOutput, runOpenCode } from "./opencode.mjs";

const job = await readJobUnsafe();

try {
  const result = await runOpenCode({
    repositoryDir: job.repositoryDir, homeDir: job.homeDir, opencodeBin: job.opencodeBin,
    model: job.model, agent: job.agent, prompt: job.prompt, timeoutMs: job.opencodeTimeoutMs,
  });
  await writeResult({ runStatus: "success", output: cleanOpenCodeOutput(result.stdout) || "Completed.", error: "" });
} catch (error) {
  const message = String(error?.message || error || "OpenCode failed").slice(0, 4000);
  await writeResult({ runStatus: "failure", output: "", error: message });
  console.error(message);
  process.exitCode = 1;
}
