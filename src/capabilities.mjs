const SUPPORTED_MODES = new Set([
  "auto",
  "plan",
  "research",
  "fix",
  "apply",
  "review",
  "security",
  "test",
  "release",
  "explain",
  "refactor",
  "ci",
]);

const READ_ONLY_MODES = new Set([
  "plan",
  "research",
  "review",
  "security",
  "test",
  "explain",
]);

const AGENT_BY_MODE = new Map([
  ["auto", "build"],
  ["plan", "plan"],
  ["research", "plan"],
  ["fix", "build"],
  ["apply", "build"],
  ["review", "plan"],
  ["security", "plan"],
  ["test", "plan"],
  ["release", "build"],
  ["explain", "plan"],
  ["refactor", "build"],
  ["ci", "build"],
]);

const MODEL_PREFERENCES = new Map([
  ["plan", ["opencode/nemotron-3-ultra-free", "opencode/nemotron-3.5-lightning-free"]],
  ["review", ["opencode/nemotron-3-ultra-free", "opencode/nemotron-3.5-lightning-free"]],
  ["security", ["opencode/nemotron-3-ultra-free", "opencode/nemotron-3.5-lightning-free"]],
  ["release", ["opencode/nemotron-3-ultra-free", "opencode/nemotron-3.5-lightning-free"]],
  ["research", ["opencode/mimo-v2.6-flash-free", "opencode/nemotron-3.5-lightning-free"]],
  ["explain", ["opencode/mimo-v2.6-flash-free", "opencode/nemotron-3.5-lightning-free"]],
  ["ci", ["opencode/nemotron-3.5-lightning-free", "opencode/mimo-v2.6-flash-free"]],
  ["test", ["opencode/nemotron-3.5-lightning-free", "opencode/mimo-v2.6-flash-free"]],
]);

const HIGH_RISK = /\b(secret|credential|auth|oauth|oidc|permission|workflow|release|publish|deploy|migration|database|schema|infrastructure|infra|docker|security|token|signing|production)\b/i;

export function isSupportedMode(value) {
  return SUPPORTED_MODES.has(String(value || "").toLowerCase());
}

export function supportedModes() {
  return [...SUPPORTED_MODES];
}

function classifyRisk(mode, prompt) {
  const text = String(prompt || "");
  if (mode === "security" || mode === "release") return "high";
  if (HIGH_RISK.test(text)) return "high";
  if (["plan", "research", "review", "explain"].includes(mode)) return "low";
  return "medium";
}

export function capabilityProfile(mode, prompt = "") {
  const normalizedMode = String(mode || "auto").toLowerCase();
  if (!isSupportedMode(normalizedMode)) {
    throw new Error("Unsupported command mode: " + normalizedMode);
  }

  const agent = AGENT_BY_MODE.get(normalizedMode);
  if (!agent) {
    throw new Error("No agent configured for mode: " + normalizedMode);
  }

  const allowEdits = !READ_ONLY_MODES.has(normalizedMode);
  const capabilities = [
    "read",
    "glob",
    "grep",
    "list",
    "skills",
    "webfetch",
    "websearch",
    "shell",
  ];
  if (allowEdits) capabilities.push("edit");

  return {
    mode: normalizedMode,
    agent,
    risk: classifyRisk(normalizedMode, prompt),
    allowEdits,
    capabilities,
  };
}

export function chooseModel({ mode, requestedModel, allowedModels, defaultModel }) {
  if (requestedModel && requestedModel !== "auto") {
    if (!allowedModels.has(requestedModel)) {
      throw new Error("Unsupported model: " + requestedModel);
    }
    return requestedModel;
  }

  for (const candidate of MODEL_PREFERENCES.get(mode) || []) {
    if (allowedModels.has(candidate)) return candidate;
  }
  return defaultModel;
}
