import assert from "node:assert/strict";
import test from "node:test";
import { capabilityProfile, chooseModel } from "../src/capabilities.mjs";

test("classifies release changes as high risk and routes edits to build", () => {
  const profile = capabilityProfile("release", "update npm OIDC publishing");
  assert.equal(profile.risk, "high");
  assert.equal(profile.allowEdits, true);
  assert.equal(profile.agent, "build");
  assert.equal(profile.capabilities.includes("edit"), true);
  assert.equal(profile.capabilities.includes("subagent"), false);
});

test("review mode is read-only and routes to built-in plan", () => {
  const profile = capabilityProfile("review", "review this PR");
  assert.equal(profile.allowEdits, false);
  assert.equal(profile.agent, "plan");
  assert.equal(profile.capabilities.includes("edit"), false);
  assert.equal(profile.capabilities.includes("shell"), true);
});

test("CI mode routes to built-in build", () => {
  const profile = capabilityProfile("ci", "repair workflow");
  assert.equal(profile.agent, "build");
  assert.equal(profile.allowEdits, true);
});

test("model router falls back to configured default", () => {
  const model = chooseModel({
    mode: "plan",
    requestedModel: "auto",
    allowedModels: new Set(["opencode/custom-free"]),
    defaultModel: "opencode/custom-free",
  });
  assert.equal(model, "opencode/custom-free");
});
