const INVOCATION = /^\/(?:oc|opencode)(?=\s|$)/i;
const MODEL_TOKEN = /(?:^|\s)model=([A-Za-z0-9._/-]+)(?=\s|$)/i;

export function parseCommand(body, { allowedModels, defaultModel }) {
  const text = String(body ?? "").trim();
  const command = text.match(INVOCATION);
  if (!command) return null;

  let remainder = text.slice(command[0].length).trim();
  const modelMatch = remainder.match(MODEL_TOKEN);
  const requestedModel = modelMatch?.[1] || null;

  if (requestedModel && !allowedModels.has(requestedModel)) {
    throw new Error(`Unsupported model: ${requestedModel}`);
  }

  if (modelMatch) {
    remainder = `${remainder.slice(0, modelMatch.index)} ${remainder.slice(
      modelMatch.index + modelMatch[0].length,
    )}`
      .replace(/\s+/g, " ")
      .trim();
  }

  return {
    model: requestedModel || defaultModel,
    prompt:
      remainder ||
      "Review this pull request. Report important findings and do not modify files unless a change is clearly required by the request context.",
  };
}
