import { chooseModel, isSupportedMode } from "./capabilities.mjs";

const INVOCATION = /^\\/(?:oc|opencode)(?=\\s|$)/i;
const MODEL_TOKEN = /(?:^|\\s)model=([A-Za-z0-9._/-]+)(?=\\s|$)/i;

function defaultPrompt(mode) {
  switch (mode) {
    case "plan": return "Analyze this pull request and produce an implementation plan. Do not modify files.";
    case "research": return "Research the relevant repository and current external documentation, then report findings with sources. Do not modify files.";
    case "review": return "Review this pull request for correctness, regressions, maintainability, and missing tests. Do not modify files.";
    case "security": return "Perform a security review of this pull request and report concrete findings. Do not modify files.";
    case "test": return "Run the most relevant tests and diagnostics for this pull request. Do not intentionally modify tracked files.";
    case "explain": return "Explain the relevant implementation and behavior in this pull request without modifying files.";
    default: return "Review this pull request. Report important findings and make only changes clearly required by the request context.";
  }
}

export function parseCommand(body, { allowedModels, defaultModel }) {
  const text = String(body ?? "").trim();
  const command = text.match(INVOCATION);
  if (!command) return null;

  let remainder = text.slice(command[0].length).trim();
  const modelMatch = remainder.match(MODEL_TOKEN);
  const requestedModel = modelMatch?.[1] || null;

  if (requestedModel && requestedModel !== "auto" && !allowedModels.has(requestedModel)) {
    throw new Error("Unsupported model: " + requestedModel);
  }

  if (modelMatch) {
    remainder = (remainder.slice(0, modelMatch.index) + " " + remainder.slice(modelMatch.index + modelMatch[0].length))
      .replace(/\\s+/g, " ")
      .trim();
  }

  let mode = "auto";
  const firstToken = remainder.match(/^([A-Za-z-]+)(?=\\s|$)/);
  if (firstToken && isSupportedMode(firstToken[1])) {
    mode = firstToken[1].toLowerCase();
    remainder = remainder.slice(firstToken[0].length).trim();
  }

  return {
    mode,
    model: chooseModel({ mode, requestedModel, allowedModels, defaultModel }),
    prompt: remainder || defaultPrompt(mode),
  };
}
