const MAX_DEPENDENCY_PRS = 30;
const MAX_TITLE = 240;
const MAX_REF = 240;
const MAX_LABELS = 12;

const BOT_IDENTITIES = new Map([
  ["dependabot[bot]", "dependabot"],
  ["renovate[bot]", "renovate"],
]);

const DEPENDABOT_ECOSYSTEMS = new Map([
  ["npm_and_yarn", "npm"],
  ["github_actions", "github-actions"],
  ["pip", "python"],
  ["pip-compile", "python"],
  ["docker", "docker"],
  ["gomod", "go"],
  ["maven", "maven"],
  ["gradle", "gradle"],
  ["bundler", "ruby"],
  ["cargo", "rust"],
  ["nuget", "dotnet"],
  ["terraform", "terraform"],
  ["composer", "php"],
  ["mix", "elixir"],
  ["pub", "dart"],
  ["elm", "elm"],
  ["gitsubmodule", "git-submodule"],
]);

function bounded(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : text.slice(0, limit) + "…";
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function commitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

function botKind(pull) {
  const login = String(pull?.user?.login || "").toLowerCase();
  if (String(pull?.user?.type || "").toLowerCase() !== "bot") return "";
  return BOT_IDENTITIES.get(login) || "";
}

function dependencyCountHint(title) {
  const group = String(title || "").match(/\bwith\s+(\d+)\s+updates?\b/i);
  if (!group) return 1;
  const count = Number(group[1]);
  return Number.isSafeInteger(count) && count > 0 && count <= 100 ? count : 1;
}

function semverParts(value) {
  const match = String(value || "").match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function scopeFromVersionPair(fromVersion, toVersion) {
  const from = semverParts(fromVersion);
  const to = semverParts(toVersion);
  if (!from || !to) return "unknown";
  if (from[0] !== to[0]) return "major";
  if (from[1] !== to[1]) return "minor";
  if (from[2] !== to[2]) return "patch";
  return "unknown";
}

function dependabotTitleEvidence(title) {
  const text = String(title || "").trim();
  const group = text.match(/^Bump the (.+?) group\b/i);
  if (group) {
    return {
      packageHint: bounded(group[1], 160),
      updateScope: "group",
      dependencyCountHint: dependencyCountHint(text),
    };
  }

  const version = text.match(/^Bump (.+?) from (\S+) to (\S+)$/i);
  if (version) {
    return {
      packageHint: bounded(version[1], 160),
      updateScope: scopeFromVersionPair(version[2], version[3]),
      dependencyCountHint: 1,
    };
  }

  return {
    packageHint: "",
    updateScope: "unknown",
    dependencyCountHint: dependencyCountHint(text),
  };
}

function renovateTitleEvidence(title) {
  const text = String(title || "").trim();
  const packageMatch = text.match(
    /\bupdate\s+(?:dependency|package|action|docker image|image)?\s*([^,]+?)\s+to\s+\S+/i,
  );
  const lower = text.toLowerCase();
  let updateScope = "unknown";
  if (/\bmajor\b/.test(lower)) updateScope = "major";
  else if (/\bminor\b/.test(lower)) updateScope = "minor";
  else if (/\bpatch\b/.test(lower)) updateScope = "patch";

  return {
    packageHint: packageMatch ? bounded(packageMatch[1], 160) : "",
    updateScope,
    dependencyCountHint: 1,
  };
}

function dependabotEcosystem(headRef) {
  const match = String(headRef || "").match(/^dependabot\/([^/]+)\//i);
  if (!match) return "unknown";
  return DEPENDABOT_ECOSYSTEMS.get(match[1].toLowerCase()) || match[1].toLowerCase();
}

function renovateEcosystem(title, headRef) {
  const text = (String(title || "") + " " + String(headRef || "")).toLowerCase();
  if (/github[-_ ]actions?|actions\//.test(text)) return "github-actions";
  if (/\b(?:npm|pnpm|yarn|node)\b/.test(text)) return "npm";
  if (/\b(?:python|pip|poetry)\b/.test(text)) return "python";
  if (/\b(?:docker|container image)\b/.test(text)) return "docker";
  if (/\b(?:golang|go module|gomod)\b/.test(text)) return "go";
  if (/\b(?:maven|gradle)\b/.test(text)) return "jvm";
  if (/\b(?:cargo|rust)\b/.test(text)) return "rust";
  if (/\b(?:nuget|dotnet)\b/.test(text)) return "dotnet";
  if (/\bterraform\b/.test(text)) return "terraform";
  return "unknown";
}

function labels(pull) {
  return (Array.isArray(pull?.labels) ? pull.labels : [])
    .map((label) => bounded(label?.name, 80))
    .filter(Boolean)
    .slice(0, MAX_LABELS);
}

function normalizedPull(pull, warnings) {
  const bot = botKind(pull);
  if (!bot) return null;

  const number = positiveInteger(pull?.number);
  const headSha = commitSha(pull?.head?.sha);
  const baseSha = commitSha(pull?.base?.sha);
  if (!number || !headSha || !baseSha) {
    warnings.push(
      "Ignored recognized dependency-bot PR with incomplete identity metadata.",
    );
    return null;
  }

  const title = bounded(pull?.title, MAX_TITLE);
  const headRef = bounded(pull?.head?.ref, MAX_REF);
  const baseRef = bounded(pull?.base?.ref, MAX_REF);
  const titleEvidence =
    bot === "dependabot"
      ? dependabotTitleEvidence(title)
      : renovateTitleEvidence(title);
  const ecosystem =
    bot === "dependabot"
      ? dependabotEcosystem(headRef)
      : renovateEcosystem(title, headRef);

  return {
    number,
    bot,
    author: String(pull?.user?.login || ""),
    title,
    url: bounded(pull?.html_url, 500),
    draft: pull?.draft === true,
    headRef,
    headSha,
    baseRef,
    baseSha,
    ecosystem,
    updateScope: titleEvidence.updateScope,
    packageHint: titleEvidence.packageHint,
    dependencyCountHint: titleEvidence.dependencyCountHint,
    labels: labels(pull),
  };
}

function laneCapacity(pr) {
  return Math.max(pr.dependencyCountHint || 1, 1);
}

function laneRecord(key, pulls) {
  const dependencyCount = pulls.reduce(
    (total, pr) => total + laneCapacity(pr),
    0,
  );
  const isolated =
    pulls.length === 1 ||
    pulls.some(
      (pr) =>
        pr.updateScope === "major" ||
        pr.updateScope === "group" ||
        pr.updateScope === "unknown" ||
        pr.ecosystem === "unknown",
    );
  return {
    id: key,
    ecosystem: pulls[0]?.ecosystem || "unknown",
    updateScope: pulls[0]?.updateScope || "unknown",
    pullNumbers: pulls.map((pr) => pr.number),
    dependencyCountHint: dependencyCount,
    strategy: isolated ? "keep-separate" : "candidate-consolidation",
    reason: isolated
      ? "High-uncertainty, major, grouped, or single dependency PR; keep isolated unless trusted review says otherwise."
      : "Same ecosystem and update scope fit the configured dependency batch bound; candidate for consolidation only.",
  };
}

function laneKey(pr) {
  return pr.ecosystem + ":" + pr.updateScope;
}

function mustIsolate(pr, maximum) {
  return (
    pr.updateScope === "major" ||
    pr.updateScope === "group" ||
    pr.updateScope === "unknown" ||
    pr.ecosystem === "unknown" ||
    pr.dependencyCountHint > maximum
  );
}

function dependencyCount(pulls) {
  return pulls.reduce((total, pr) => total + laneCapacity(pr), 0);
}

function nextBatchId(lanes, key) {
  const prefix = key + ":batch-";
  const count = lanes.filter((lane) => lane.id.startsWith(prefix)).length;
  return prefix + (count + 1);
}

function flushBatch(lanes, key, bucket) {
  if (!bucket.length) return;
  lanes.push(laneRecord(nextBatchId(lanes, key), bucket));
}

function planDependencyLanes(normalized, maximum) {
  const buckets = new Map();
  const lanes = [];

  for (const pr of normalized) {
    if (mustIsolate(pr, maximum)) {
      lanes.push(laneRecord(laneKey(pr) + ":pr-" + pr.number, [pr]));
      continue;
    }

    const key = laneKey(pr);
    const bucket = buckets.get(key) || [];
    if (
      bucket.length > 0 &&
      dependencyCount(bucket) + laneCapacity(pr) > maximum
    ) {
      flushBatch(lanes, key, bucket);
      buckets.set(key, [pr]);
      continue;
    }
    bucket.push(pr);
    buckets.set(key, bucket);
  }

  for (const [key, bucket] of buckets) {
    flushBatch(lanes, key, bucket);
  }

  return lanes.sort(
    (a, b) => (a.pullNumbers[0] || 0) - (b.pullNumbers[0] || 0),
  );
}

function normalizeRecognizedPulls(pulls, warnings) {
  const normalized = [];
  const rows = Array.isArray(pulls) ? pulls : [];
  let truncated = false;

  for (let index = 0; index < rows.length; index += 1) {
    const pr = normalizedPull(rows[index], warnings);
    if (!pr) continue;
    if (normalized.length >= MAX_DEPENDENCY_PRS) {
      truncated = true;
      break;
    }
    normalized.push(pr);
  }

  if (truncated) {
    warnings.push(
      "Dependency PR evidence truncated at " +
        MAX_DEPENDENCY_PRS +
        " recognized bot pull requests.",
    );
  }
  return normalized.sort((a, b) => a.number - b.number);
}

export function collectDependencyPullRequestEvidence(
  pulls,
  maxDependenciesPerBatch,
) {
  const maximum = Number(maxDependenciesPerBatch);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 20) {
    throw new Error("Invalid dependency batch bound");
  }

  const warnings = [];
  const normalized = normalizeRecognizedPulls(pulls, warnings);
  return {
    pullRequests: normalized,
    lanes: planDependencyLanes(normalized, maximum),
    warnings: [...new Set(warnings)],
  };
}
