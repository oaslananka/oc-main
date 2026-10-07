import assert from "node:assert/strict";
import test from "node:test";
import { collectDependencyPullRequestEvidence } from "../src/dependency-prs.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function pull({
  number,
  login = "dependabot[bot]",
  type = "Bot",
  title,
  headRef,
  headSha = SHA_B,
  baseRef = "main",
  baseSha = SHA_A,
  labels = [],
}) {
  return {
    number,
    state: "open",
    title,
    html_url: "https://github.com/owner/repo/pull/" + number,
    draft: false,
    user: { login, type },
    head: { ref: headRef, sha: headSha },
    base: { ref: baseRef, sha: baseSha },
    labels: labels.map((name) => ({ name })),
  };
}

test("normalizes official Dependabot identity, ecosystem, package and semver scope", () => {
  const evidence = collectDependencyPullRequestEvidence(
    [
      pull({
        number: 11,
        title: "Bump lodash from 4.17.21 to 5.0.0",
        headRef: "dependabot/npm_and_yarn/lodash-5.0.0",
        labels: ["dependencies", "javascript"],
      }),
    ],
    5,
  );

  assert.equal(evidence.pullRequests.length, 1);
  assert.deepEqual(
    {
      bot: evidence.pullRequests[0].bot,
      ecosystem: evidence.pullRequests[0].ecosystem,
      updateScope: evidence.pullRequests[0].updateScope,
      packageHint: evidence.pullRequests[0].packageHint,
      dependencyCountHint: evidence.pullRequests[0].dependencyCountHint,
    },
    {
      bot: "dependabot",
      ecosystem: "npm",
      updateScope: "major",
      packageHint: "lodash",
      dependencyCountHint: 1,
    },
  );
  assert.deepEqual(evidence.pullRequests[0].labels, [
    "dependencies",
    "javascript",
  ]);
  assert.equal(evidence.lanes[0].strategy, "keep-separate");
});

test("rejects lookalike dependency-bot logins that are not GitHub Bot actors", () => {
  const evidence = collectDependencyPullRequestEvidence(
    [
      pull({
        number: 12,
        type: "User",
        title: "Bump lodash from 4.17.21 to 4.17.22",
        headRef: "dependabot/npm_and_yarn/lodash-4.17.22",
      }),
      pull({
        number: 13,
        login: "dependabot-helper",
        type: "Bot",
        title: "Bump lodash from 4.17.21 to 4.17.22",
        headRef: "dependabot/npm_and_yarn/lodash-4.17.22",
      }),
    ],
    5,
  );

  assert.deepEqual(evidence.pullRequests, []);
  assert.deepEqual(evidence.lanes, []);
});

test("maps Dependabot GitHub Actions branches and patch versions", () => {
  const evidence = collectDependencyPullRequestEvidence(
    [
      pull({
        number: 14,
        title: "Bump actions/checkout from 4.1.0 to 4.1.1",
        headRef: "dependabot/github_actions/actions/checkout-4.1.1",
      }),
    ],
    5,
  );

  assert.equal(evidence.pullRequests[0].ecosystem, "github-actions");
  assert.equal(evidence.pullRequests[0].updateScope, "patch");
  assert.equal(evidence.pullRequests[0].packageHint, "actions/checkout");
});

test("keeps recognized bot PRs with invalid exact identity out of evidence", () => {
  const evidence = collectDependencyPullRequestEvidence(
    [
      pull({
        number: 15,
        title: "Bump lodash from 4.17.21 to 4.17.22",
        headRef: "dependabot/npm_and_yarn/lodash-4.17.22",
        headSha: "not-a-sha",
      }),
    ],
    5,
  );

  assert.deepEqual(evidence.pullRequests, []);
  assert.match(evidence.warnings[0], /incomplete identity metadata/);
});

test("recognizes Renovate bot metadata without inventing ecosystem certainty", () => {
  const evidence = collectDependencyPullRequestEvidence(
    [
      pull({
        number: 16,
        login: "renovate[bot]",
        title: "chore(deps): update dependency eslint to v10",
        headRef: "renovate/eslint-10.x",
      }),
    ],
    5,
  );

  assert.equal(evidence.pullRequests[0].bot, "renovate");
  assert.equal(evidence.pullRequests[0].packageHint, "eslint");
  assert.equal(evidence.pullRequests[0].ecosystem, "unknown");
  assert.equal(evidence.pullRequests[0].updateScope, "unknown");
  assert.equal(evidence.lanes[0].strategy, "keep-separate");
});

test("groups same-ecosystem patch PRs only within the dependency batch bound", () => {
  const evidence = collectDependencyPullRequestEvidence(
    [
      pull({
        number: 21,
        title: "Bump alpha from 1.0.0 to 1.0.1",
        headRef: "dependabot/npm_and_yarn/alpha-1.0.1",
      }),
      pull({
        number: 22,
        title: "Bump beta from 2.0.0 to 2.0.1",
        headRef: "dependabot/npm_and_yarn/beta-2.0.1",
      }),
      pull({
        number: 23,
        title: "Bump gamma from 3.0.0 to 3.0.1",
        headRef: "dependabot/npm_and_yarn/gamma-3.0.1",
      }),
    ],
    2,
  );

  assert.equal(evidence.lanes.length, 2);
  assert.deepEqual(evidence.lanes[0].pullNumbers, [21, 22]);
  assert.equal(evidence.lanes[0].strategy, "candidate-consolidation");
  assert.deepEqual(evidence.lanes[1].pullNumbers, [23]);
  assert.equal(evidence.lanes[1].strategy, "keep-separate");
});

test("uses Dependabot group size hints and keeps over-bound groups isolated", () => {
  const evidence = collectDependencyPullRequestEvidence(
    [
      pull({
        number: 31,
        title: "Bump the production-dependencies group across 1 directory with 7 updates",
        headRef:
          "dependabot/npm_and_yarn/production-dependencies-7f45f462c2",
      }),
    ],
    5,
  );

  assert.equal(evidence.pullRequests[0].updateScope, "group");
  assert.equal(evidence.pullRequests[0].dependencyCountHint, 7);
  assert.equal(evidence.lanes[0].strategy, "keep-separate");
  assert.equal(evidence.lanes[0].dependencyCountHint, 7);
});

test("rejects invalid policy batch bounds", () => {
  assert.throws(
    () => collectDependencyPullRequestEvidence([], 0),
    /Invalid dependency batch bound/,
  );
  assert.throws(
    () => collectDependencyPullRequestEvidence([], 21),
    /Invalid dependency batch bound/,
  );
});

test("warns when recognized dependency PR evidence is truncated", () => {
  const rows = Array.from({ length: 31 }, (_, index) =>
    pull({
      number: 100 + index,
      title: "Bump pkg-" + index + " from 1.0.0 to 1.0.1",
      headRef:
        "dependabot/npm_and_yarn/pkg-" + index + "-1.0.1",
    }),
  );
  const evidence = collectDependencyPullRequestEvidence(rows, 5);

  assert.equal(evidence.pullRequests.length, 30);
  assert.match(evidence.warnings[0], /truncated at 30 recognized bot pull requests/);
});

test("never consolidates dependency PRs across base branches", () => {
  const evidence = collectDependencyPullRequestEvidence(
    [
      pull({
        number: 51,
        title: "Bump alpha from 1.0.0 to 1.0.1",
        headRef: "dependabot/npm_and_yarn/alpha-1.0.1",
        baseRef: "main",
      }),
      pull({
        number: 52,
        title: "Bump beta from 1.0.0 to 1.0.1",
        headRef: "dependabot/npm_and_yarn/beta-1.0.1",
        baseRef: "release/1.x",
      }),
    ],
    5,
  );

  assert.equal(evidence.lanes.length, 2);
  assert.deepEqual(evidence.lanes[0].pullNumbers, [51]);
  assert.deepEqual(evidence.lanes[1].pullNumbers, [52]);
  assert.match(evidence.lanes[0].id, /base-main/);
  assert.match(evidence.lanes[1].id, /base-release%2F1\.x/);
});
