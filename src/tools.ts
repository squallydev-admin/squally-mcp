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
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "squally-list-projects",
    title: "List projects",
    operationId: "listProjects",
    description:
      "Lists the projects in your Squally organization. Start here: every other tool needs a " +
      "projectId, and this is the only tool that produces one.",
  },
  {
    name: "squally-find-run",
    title: "Find runs",
    operationId: "listRuns",
    description:
      "Finds CI runs of a project - the latest, or filtered by branch, commit SHA or status. " +
      "One row per logical run: a sharded run is collapsed into a single entry. Returns summary " +
      "counters only; use squally-get-run for the per-test rows.",
  },
  {
    name: "squally-get-run",
    title: "Get one run",
    operationId: "getRun",
    description:
      "One run with its per-test result rows, across every shard. Use this to find out which " +
      "test is red in a run; the run list carries only the counters.",
  },
  {
    name: "squally-debug-failure",
    title: "Debug a failing test",
    operationId: "getRunTestAttempts",
    description:
      "Every attempt of one test in one run, oldest first, each with the error, the stack and " +
      "the Copy-for-AI prompt (the same text the Squally UI puts on the clipboard). This is the " +
      "tool for 'why did this test fail'. If the test name is ambiguous, pass filePath.",
  },
  {
    name: "squally-get-test-status",
    title: "Get a test's status",
    operationId: "getTestStatus",
    description:
      "The stored flakiness status and active signals for ONE test. Cheap - one findUnique. " +
      "Use this when you are asking about a single test; do not reach for " +
      "squally-list-flaky-tests, which is expensive.",
  },
  {
    name: "squally-list-flaky-tests",
    title: "List flaky tests",
    operationId: "listFlakyTests",
    description:
      "The project's flaky and broken tests, ranked, with the time each has cost (timeLostMs). " +
      "Expensive - one engine pass over the project's recent runs. For a single test use " +
      "squally-get-test-status instead.",
  },
  {
    name: "squally-list-errors",
    title: "List error signatures",
    operationId: "listErrors",
    description:
      "The project's error signatures in a period: failures grouped by fingerprint, with how " +
      "often and how recently each occurred. Answers 'is this failure one instance of something " +
      "that keeps happening' - a grouping no agent can compute from the repository alone.",
  },
];
