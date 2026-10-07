import { decideMaintenanceCampaignContinuation } from "./campaign-scheduler.mjs";

export const DEFAULT_OBSERVER_MAX_ATTEMPTS = 7;
export const DEFAULT_OBSERVER_INTERVAL_MS = 45_000;

function checkedAttempts(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 20) {
    throw new Error("Observer max attempts must be between 1 and 20");
  }
  return number;
}

function checkedInterval(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 120_000) {
    throw new Error("Observer interval must be between 0 and 120000 ms");
  }
  return number;
}

function checkedFunction(value, label) {
  if (typeof value !== "function") {
    throw new TypeError("Observer " + label + " must be a function");
  }
  return value;
}

function shouldObserveAgain(decision) {
  return (
    decision?.action === "refresh-evidence" ||
    (decision?.action === "hold" &&
      decision?.reason === "required-checks-pending")
  );
}

function timeoutDecision() {
  return Object.freeze({
    action: "owner-review",
    reason: "observation-timeout",
    statusPhase: "owner-review",
    dispatchEligible: false,
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function observeMaintenanceCampaign({
  loadSnapshot,
  updateStatus,
  evaluate = decideMaintenanceCampaignContinuation,
  sleep = delay,
  maxAttempts = DEFAULT_OBSERVER_MAX_ATTEMPTS,
  intervalMs = DEFAULT_OBSERVER_INTERVAL_MS,
} = {}) {
  const load = checkedFunction(loadSnapshot, "snapshot loader");
  const update = checkedFunction(updateStatus, "status updater");
  const decide = checkedFunction(evaluate, "decision function");
  const wait = checkedFunction(sleep, "sleep function");
  const attemptsLimit = checkedAttempts(maxAttempts);
  const interval = checkedInterval(intervalMs);

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    const snapshot = await load({ attempt });
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Observer snapshot is unavailable");
    }

    const decision = decide(snapshot);
    if (!shouldObserveAgain(decision)) {
      await update({ snapshot, decision, attempt, timedOut: false });
      return Object.freeze({
        attempts: attempt,
        timedOut: false,
        decision,
      });
    }

    if (attempt === attemptsLimit) {
      const timedOut = timeoutDecision();
      await update({ snapshot, decision: timedOut, attempt, timedOut: true });
      return Object.freeze({
        attempts: attempt,
        timedOut: true,
        decision: timedOut,
      });
    }

    await update({ snapshot, decision, attempt, timedOut: false });
    await wait(interval);
  }

  throw new Error("Observer loop exhausted unexpectedly");
}
