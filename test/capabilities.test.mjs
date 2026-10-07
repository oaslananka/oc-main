import assert from "node:assert/strict";
import test from "node:test";
import { capabilityProfile, chooseModel } from "../src/capabilities.mjs";

test("classifies release changes as high risk", () => {
  const profile = capabilityProfile("release", "update npm OIDC publishing");
  assert.equal(profile.risk, "high");
  assert.equal(profile.allowEdits, true);
});

test("review mode is read-only", () => {
  const profile = capabilityProfile("review", "review this PR");
  assert.equal(profile.allowEdits, false);
  assert.equal(profile.agent, "reviewer");
});

test("model router falls back to configured default", () => {
  const model = chooseModel({ mode: "plan", requestedModel: "auto", allowedModels: new Set(["opencode/custom-free"]), defaultModel: "opencode/custom-free" });
  assert.equal(model, "opencode/custom-free");
});
