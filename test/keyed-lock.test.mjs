import assert from "node:assert/strict";
import test from "node:test";
import { createKeyedSerialExecutor } from "../src/keyed-lock.mjs";

test("serializes work for the same key", async () => {
  const executor = createKeyedSerialExecutor();
  const events = [];
  let releaseFirst;
  let confirmFirstStarted;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise((resolve) => {
    confirmFirstStarted = resolve;
  });

  const first = executor.run("repo#7", async () => {
    events.push("first-start");
    confirmFirstStarted();
    await gate;
    events.push("first-end");
  });
  const second = executor.run("repo#7", async () => {
    events.push("second-start");
    events.push("second-end");
  });

  await firstStarted;
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "first-start",
    "first-end",
    "second-start",
    "second-end",
  ]);
  assert.equal(executor.size(), 0);
});

test("allows unrelated keys to proceed independently", async () => {
  const executor = createKeyedSerialExecutor();
  const events = [];
  await Promise.all([
    executor.run("repo#1", async () => events.push("one")),
    executor.run("repo#2", async () => events.push("two")),
  ]);
  assert.deepEqual(new Set(events), new Set(["one", "two"]));
});

test("continues queued work after an earlier task fails", async () => {
  const executor = createKeyedSerialExecutor();
  const first = executor.run("repo#9", async () => {
    throw new Error("boom");
  });
  const second = executor.run("repo#9", async () => "ok");

  await assert.rejects(first, /boom/);
  assert.equal(await second, "ok");
  assert.equal(executor.size(), 0);
});
