import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function actionWorkRoot() {
  return path.resolve(
    process.env.OC_ACTION_WORK_ROOT?.trim() ||
      path.join(process.env.RUNNER_TEMP || "/tmp", "oc-main-job"),
  );
}

function jobPath() {
  return path.join(actionWorkRoot(), "job.json");
}

function resultPath() {
  return path.join(actionWorkRoot(), "result.json");
}

function signJob(job, secret) {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(job))
    .digest("hex")}`;
}

export async function writeJob(job, secret) {
  await fs.mkdir(actionWorkRoot(), { recursive: true });
  await fs.writeFile(
    jobPath(),
    JSON.stringify({ job, signature: signJob(job, secret) }, null, 2),
    { mode: 0o600 },
  );
}

export async function readJobUnsafe() {
  const record = JSON.parse(await fs.readFile(jobPath(), "utf8"));
  return record.job;
}

export async function readVerifiedJob(secret) {
  const record = JSON.parse(await fs.readFile(jobPath(), "utf8"));
  const expected = signJob(record.job, secret);
  const provided = String(record.signature || "");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new Error("Prepared worker state signature is invalid");
  }

  return record.job;
}

export async function writeResult(result) {
  await fs.writeFile(resultPath(), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
}

export async function readResult() {
  try {
    return JSON.parse(await fs.readFile(resultPath(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        runStatus: "failure",
        output: "",
        error: "OpenCode step ended without producing a result",
      };
    }
    throw error;
  }
}
