import crypto from "node:crypto";

const CAMPAIGN_STATE_PREFIX = "<!-- oc-main-maintenance-campaign-state:";
const CAMPAIGN_STATE_PATTERN =
  /<!-- oc-main-maintenance-campaign-state:([A-Za-z0-9_-]+):([0-9a-f]{64}) -->/g;
const CAMPAIGN_LEASE_SECONDS = 45 * 60;

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid maintenance campaign " + label);
  }
  return number;
}

function nullablePositiveInteger(value, label) {
  if (value === null || value === undefined) return null;
  return positiveInteger(value, label);
}

function boundedIteration(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 8) {
    throw new Error("Invalid maintenance campaign iteration");
  }
  return number;
}

function commitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Invalid maintenance campaign commit SHA");
  }
  return sha;
}

function normalizedState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Maintenance campaign state is missing");
  }
  const state = {
    version: Number(value.version),
    source_issue: positiveInteger(value.source_issue, "source issue"),
    source_comment_id: positiveInteger(
      value.source_comment_id,
      "source comment ID",
    ),
    campaign_pr: positiveInteger(value.campaign_pr, "pull request"),
    expected_head: commitSha(value.expected_head),
    iteration: boundedIteration(value.iteration),
    terminal: value.terminal === true,
    in_flight: value.in_flight === true,
    active_comment_id: nullablePositiveInteger(
      value.active_comment_id,
      "active comment ID",
    ),
    last_comment_id: nullablePositiveInteger(
      value.last_comment_id,
      "last comment ID",
    ),
    started_at: nullablePositiveInteger(value.started_at, "start time"),
  };
  if (state.version !== 1) {
    throw new Error("Unsupported maintenance campaign state version");
  }
  if (state.in_flight) {
    if (
      state.iteration === 0 ||
      state.terminal ||
      !state.active_comment_id ||
      !state.started_at
    ) {
      throw new Error("In-flight maintenance campaign state is incomplete");
    }
  } else if (state.active_comment_id || state.started_at) {
    throw new Error("Idle maintenance campaign state contains active fields");
  }
  return state;
}

function stateMaterial(state) {
  const value = normalizedState(state);
  return JSON.stringify([
    value.version,
    value.source_issue,
    value.source_comment_id,
    value.campaign_pr,
    value.expected_head,
    value.iteration,
    value.terminal,
    value.in_flight,
    value.active_comment_id,
    value.last_comment_id,
    value.started_at,
  ]);
}

function stateSignature(state, secret) {
  const key = String(secret || "");
  if (!key) throw new Error("Maintenance campaign state secret is missing");
  return crypto
    .createHmac("sha256", key)
    .update(stateMaterial(state))
    .digest("hex");
}

function signaturesEqual(expected, provided) {
  const left = Buffer.from(String(expected || ""));
  const right = Buffer.from(String(provided || ""));
  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

function encodedState(state) {
  return Buffer.from(JSON.stringify(normalizedState(state)), "utf8").toString(
    "base64url",
  );
}

function decodedState(encoded) {
  if (!encoded || encoded.length > 4096) {
    throw new Error("Invalid maintenance campaign state payload");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid maintenance campaign state payload");
  }
  return normalizedState(parsed);
}

function markerMatches(body) {
  const text = String(body || "");
  const matches = [...text.matchAll(CAMPAIGN_STATE_PATTERN)];
  if (text.includes(CAMPAIGN_STATE_PREFIX) && matches.length === 0) {
    throw new Error("Malformed maintenance campaign state marker");
  }
  if (matches.length > 1) {
    throw new Error("Multiple maintenance campaign state markers are not allowed");
  }
  return matches;
}

export function isMaintenanceCampaignBranchName(value) {
  return /^oc-maintenance-issue-[1-9]\d*-comment-[1-9]\d*(?:-retry)?$/.test(
    String(value || ""),
  );
}

export function createInitialMaintenanceCampaignState({
  issueNumber,
  commentId,
  pullNumber,
  headSha,
}) {
  return normalizedState({
    version: 1,
    source_issue: issueNumber,
    source_comment_id: commentId,
    campaign_pr: pullNumber,
    expected_head: headSha,
    iteration: 0,
    terminal: false,
    in_flight: false,
    active_comment_id: null,
    last_comment_id: null,
    started_at: null,
  });
}

export function maintenanceCampaignStateMarker(state, secret) {
  const normalized = normalizedState(state);
  return (
    CAMPAIGN_STATE_PREFIX +
    encodedState(normalized) +
    ":" +
    stateSignature(normalized, secret) +
    " -->"
  );
}

export function readMaintenanceCampaignState(body, secret) {
  const matches = markerMatches(body);
  if (matches.length === 0) return null;
  const state = decodedState(matches[0][1]);
  const provided = matches[0][2];
  const expected = stateSignature(state, secret);
  if (!signaturesEqual(expected, provided)) {
    throw new Error("Maintenance campaign state signature is invalid");
  }
  return state;
}

export function writeMaintenanceCampaignState(body, state, secret) {
  const text = String(body || "");
  const matches = markerMatches(text);
  if (matches.length === 1) {
    const current = decodedState(matches[0][1]);
    const expected = stateSignature(current, secret);
    if (!signaturesEqual(expected, matches[0][2])) {
      throw new Error("Maintenance campaign state signature is invalid");
    }
    return text.replace(
      matches[0][0],
      maintenanceCampaignStateMarker(state, secret),
    );
  }
  return (
    text.trimEnd() +
    (text.trim() ? "\n\n" : "") +
    maintenanceCampaignStateMarker(state, secret)
  );
}

export function beginMaintenanceCampaignIteration(
  state,
  { commentId, currentHead, maxIterations, nowSeconds },
) {
  const current = normalizedState(state);
  const triggerComment = positiveInteger(commentId, "trigger comment ID");
  const head = commitSha(currentHead);
  const maximum = Number(maxIterations);
  const startedAt = positiveInteger(nowSeconds, "start time");
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 8) {
    throw new Error("Invalid maintenance campaign max iterations");
  }

  if (current.terminal) {
    return { action: "terminal", state: current };
  }
  if (current.expected_head !== head) {
    return { action: "stale", state: current };
  }
  if (current.last_comment_id === triggerComment) {
    return { action: "duplicate", state: current };
  }

  let available = current;
  if (current.in_flight) {
    const leaseAge = startedAt - current.started_at;
    if (leaseAge <= CAMPAIGN_LEASE_SECONDS) {
      return { action: "busy", state: current };
    }
    available = normalizedState({
      ...current,
      iteration: current.iteration - 1,
      in_flight: false,
      active_comment_id: null,
      started_at: null,
    });
  }

  if (available.iteration >= maximum) {
    return {
      action: "limit",
      state: normalizedState({ ...available, terminal: true }),
    };
  }

  return {
    action: "dispatch",
    state: normalizedState({
      ...available,
      iteration: available.iteration + 1,
      in_flight: true,
      active_comment_id: triggerComment,
      started_at: startedAt,
    }),
  };
}

function assertActiveIteration(
  state,
  { commentId, iteration, expectedHead },
) {
  const current = normalizedState(state);
  const triggerComment = positiveInteger(commentId, "trigger comment ID");
  const expectedIteration = boundedIteration(iteration);
  const head = commitSha(expectedHead);
  if (
    current.terminal ||
    !current.in_flight ||
    current.active_comment_id !== triggerComment ||
    current.iteration !== expectedIteration ||
    current.expected_head !== head
  ) {
    throw new Error("Maintenance campaign iteration state is stale");
  }
  return current;
}

export function assertActiveMaintenanceCampaignJob(
  state,
  { pullNumber, commentId, headSha },
) {
  const current = normalizedState(state);
  if (current.campaign_pr !== positiveInteger(pullNumber, "pull request")) {
    throw new Error("Maintenance campaign pull request identity is invalid");
  }
  if (
    current.terminal ||
    !current.in_flight ||
    current.active_comment_id !==
      positiveInteger(commentId, "trigger comment ID") ||
    current.expected_head !== commitSha(headSha)
  ) {
    throw new Error("Maintenance campaign job state is stale");
  }
  return current;
}

export function abortMaintenanceCampaignIteration(
  state,
  { commentId, iteration, expectedHead },
) {
  const current = assertActiveIteration(state, {
    commentId,
    iteration,
    expectedHead,
  });
  return normalizedState({
    ...current,
    iteration: current.iteration - 1,
    in_flight: false,
    active_comment_id: null,
    started_at: null,
  });
}

export function completeMaintenanceCampaignIteration(
  state,
  {
    commentId,
    iteration,
    expectedHead,
    newHead,
    terminal = false,
  },
) {
  const current = assertActiveIteration(state, {
    commentId,
    iteration,
    expectedHead,
  });
  return normalizedState({
    ...current,
    expected_head: commitSha(newHead),
    terminal: current.terminal || terminal === true,
    in_flight: false,
    active_comment_id: null,
    last_comment_id: positiveInteger(commentId, "trigger comment ID"),
    started_at: null,
  });
}
