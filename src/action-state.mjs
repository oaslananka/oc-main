import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const WORK_ROOT = ".oc-main-job";
const JOB_FILE = ".oc-main-job/job.json";
const RESULT_FILE = ".oc-main-job/result.json";

export function actionWorkRoot() {
  return path.resolve(WORK_ROOT);
}

function signJob(job, secret) {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(job))
    .digest("hex")}`;
}

export async function writeJob(job, secret) {
  await fs.mkdir(".oc-main-job", { recursive: true });
  await fs.writeFile(
    ".oc-main-job/job.json",
    JSON.stringify({ job, signature: signJob(job, secret) }, null, 2),
    { mode: 0o600 },
  );
}

export async function readJobUnsafe() {
  const record = JSON.parse(
    await fs.readFile(".oc-main-job/job.json", "utf8"),
  );
  return record.job;
}

export async function readVerifiedJob(secret) {
  const record = JSON.parse(
    await fs.readFile(".oc-main-job/job.json", "utf8"),
  );
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
  await fs.writeFile(
    ".oc-main-job/result.json",
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
}

export async function readResult() {
  try {
    return JSON.parse(
      await fs.readFile(".oc-main-job/result.json", "utf8"),
    );
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
