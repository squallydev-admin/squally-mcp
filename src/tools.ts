// The seven tools of read-api-mcp-spec §5.1, in that order.
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
   * FOR PEOPLE: "expensive" is the one engine pass (§4.2.2), everything else
   * is "cheap". The model learns the same from `description` and the server
   * instructions, not from this.
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
    name: "squally-get-test-status",
    title: "Get a test's status",
    operationId: "getTestStatus",
    description:
      "The stored flakiness status and active signals for ONE test. Cheap - one findUnique. " +
      "Use this when you are asking about a single test; do not reach for " +
      "squally-list-flaky-tests, which is expensive.",
    answers: "The stored flakiness status of one test.",
    cost: "cheap",
  },
  {
    name: "squally-list-flaky-tests",
    title: "List flaky tests",
    operationId: "listFlakyTests",
    description:
      "The project's flaky and broken tests, ranked, with the time each has cost (timeLostMs). " +
      "Expensive - one engine pass over the project's recent runs. For a single test use " +
      "squally-get-test-status instead.",
    answers: "The ranked flaky/broken list with time lost.",
    cost: "expensive",
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
