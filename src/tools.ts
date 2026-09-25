// The seven tools of read-api-mcp-spec §5.1, in that order.
//
// 0.2.0 REPLACED TWO OF THEM IN PLACE, with API 1.0.0-beta.2: the verdict
// engine behind squally-get-test-status and squally-list-flaky-tests was
// removed from squally-app on 25.09.2026, and squally-get-test-metrics and
// squally-list-tests read the per-test metrics that replaced it. Still seven:
// two out, two in. (§5.1 of the spec names the old two until it is updated.)
//
// The set is CLOSED (§5.1) and five endpoints are deliberately without a tool
// (§5.5) - /branches, /errors/{fingerprint}, /tests/{testName}, /overview and
// /settings. They stay fully supported REST endpoints; "no tool" is a
// statement about the agent surface. Adding one here is a decision about the
// context every session pays for, not a convenience.
//
// NAMES: squally-<verb>-<noun>, always prefixed (§5.0). The prefix is not
// branding - an agent has several servers loaded at once, and a bare
// `list_projects` is ambiguous the moment another server offers one.
//
// IMPORTED BY OTHERS: package.json exports this module as `squally-mcp/tools`
// (the docs build its tool table from it). So it stays pure data - no runtime
// import, no side effect; the type import below is erased by tsc.
// test/exports.test.js imports it through the package name and fails if that
// starts anything.
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * §5.4, on every tool. `readOnlyHint` is what lets a client run these without
 * a confirmation prompt, and it is structurally true here: this server issues
 * GETs and has no code path that writes.
 */
export const ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export type ToolDefinition = {
  name: string;
  title: string;
  operationId: string;
  description: string;
  /**
   * FOR PEOPLE, NOT THE MODEL: what the tool answers, in one line - the
   * README's tool table and the docs' tool list. Never sent to a client:
   * toolList() (server.ts) copies the wire fields one by one, and the digest
   * pinned in test/tools.test.js would catch a leak.
   */
  answers: string;
  /**
   * FOR PEOPLE: "expensive" was the one engine pass (§4.2.2), everything else
   * is "cheap". Since 0.2.0 no tool is expensive - the engine is gone, and the
   * tests list is paged in the database. The value stays in the type for the
   * consumers of `squally-mcp/tools` (the docs), which render both. The model
   * learns the cost from `description` and the server instructions, not from
   * this.
   */
  cost: "cheap" | "expensive";
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "squally-list-projects",
    title: "List projects",
    operationId: "listProjects",
    description:
      "Lists the projects in your Squally organization. Start here: every other tool needs a " +
      "projectId, and this is the only tool that produces one.",
    answers: "Which projects exist. Start here — every other tool needs a projectId from it.",
    cost: "cheap",
  },
  {
    name: "squally-find-run",
    title: "Find runs",
    operationId: "listRuns",
    description:
      "Finds CI runs of a project - the latest, or filtered by branch, commit SHA or status. " +
      "One row per logical run: a sharded run is collapsed into a single entry. Returns summary " +
      "counters only; use squally-get-run for the per-test rows.",
    answers: "Which runs happened — latest, or by branch, commit SHA or status. Counters only.",
    cost: "cheap",
  },
  {
    name: "squally-get-run",
    title: "Get one run",
    operationId: "getRun",
    description:
      "One run with its per-test result rows, across every shard. Use this to find out which " +
      "test is red in a run; the run list carries only the counters.",
    answers: "One run with its per-test rows, across all shards. Which test is red.",
    cost: "cheap",
  },
  {
    name: "squally-debug-failure",
    title: "Debug a failing test",
    operationId: "getRunTestAttempts",
    description:
      "Every attempt of one test in one run, oldest first, each with the error, the stack and " +
      "the Copy-for-AI prompt (the same text the Squally UI puts on the clipboard). This is the " +
      "tool for 'why did this test fail'. If the test name is ambiguous, pass filePath.",
    answers: "Every attempt of one test in one run: error, stack, Copy-for-AI prompt.",
    cost: "cheap",
  },
  {
    name: "squally-get-test-metrics",
    title: "Get one test's metrics",
    operationId: "getTestMetrics",
    description:
      "One test's numbers over a period: runs, stability (runs that passed on the first try " +
      "/ runs), flakyRate (runs that passed only after a retry / runs), failureRate (failed " +
      "runs / runs), time lost to retries and failures, its last 20 runs and the branches it " +
      "ran on. Counts completed CI runs of the period, without runs where most of the suite " +
      "failed at once; local runs never count. There is no verdict - the tool returns the " +
      "numbers and you judge them. runs = 0 with null rates is a valid answer: no completed " +
      "CI run of this test in the period. Cheap; for one test use this, not squally-list-tests.",
    answers: "One test's stability, flaky rate and failure rate over a period.",
    cost: "cheap",
  },
  {
    name: "squally-list-tests",
    title: "List tests",
    operationId: "listTests",
    description:
      "Every test with a completed CI run in the period, with the same numbers per test as " +
      "squally-get-test-metrics - runs, stability, flakyRate, failureRate, time lost - ranked " +
      "worst first by the chosen sort (default: lowest stability). There is no verdict and no " +
      "status - the tool labels no test; you judge the numbers. Moderate - two queries over " +
      "the period, paged; for a single test use squally-get-test-metrics.",
    answers: "Every test with a CI run in the period, ranked by stability, flaky rate or failures.",
    cost: "cheap",
  },
  {
    name: "squally-list-errors",
    title: "List error signatures",
    operationId: "listErrors",
    description:
      "The project's error signatures in a period: failures grouped by fingerprint, with how " +
      "often and how recently each occurred. Answers 'is this failure one instance of something " +
      "that keeps happening' - a grouping no agent can compute from the repository alone.",
    answers: "Error signatures in a period: what keeps failing, grouped.",
    cost: "cheap",
  },
];
