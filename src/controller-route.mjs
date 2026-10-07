function repositoryName(value) {
  const repository = String(value || "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Invalid controller route repository");
  }
  return repository;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid controller route " + label);
  }
  return number;
}

export function controllerRouteKey({
  repository,
  maintenance = false,
  issueNumber = null,
  pullNumber = null,
} = {}) {
  const repo = repositoryName(repository);
  if (maintenance) return repo + "#maintenance";
  if (issueNumber !== null && issueNumber !== undefined) {
    return repo + "#issue-" + positiveInteger(issueNumber, "issue number");
  }
  return repo + "#pr-" + positiveInteger(pullNumber, "pull request number");
}