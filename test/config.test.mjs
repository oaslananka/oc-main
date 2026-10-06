import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.mjs";

const KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "ALLOWED_GITHUB_USER_IDS",
];

function withEnvironment(values, fn) {
  const previous = new Map(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);

  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("configuration fails closed when the user allowlist is absent", { concurrency: false }, () => {
  withEnvironment(
    {
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from("test-key").toString("base64"),
      GITHUB_WEBHOOK_SECRET: "secret",
    },
    () => {
      assert.throws(() => loadConfig(), /ALLOWED_GITHUB_USER_IDS/);
    },
  );
});

test("configuration accepts explicit numeric user IDs", { concurrency: false }, () => {
  withEnvironment(
    {
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from("test-key").toString("base64"),
      GITHUB_WEBHOOK_SECRET: "secret",
      ALLOWED_GITHUB_USER_IDS: "285490571,42",
    },
    () => {
      const config = loadConfig();
      assert.deepEqual([...config.allowedUserIds], [285490571, 42]);
    },
  );
});
