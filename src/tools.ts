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
// PER TEST ACROSS PLAYWRIGHT PROJECTS SINCE 0.9.0 (API 1.0.0-beta.19): the
// run tools count like Playwright, one row per project variant; the tools that
// collect across runs - squally-get-test-metrics, squally-list-tests,
// squally-list-errors - count a test once across its projects and name them.
// Each description says which of the two it is, because a name from one side
// passed to the other is the mistake (squally-debug-failure takes the variant's
// name, squally-get-test-metrics the test's).
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
      "Finds runs of a project, CI and local alike - the latest, or filtered by branch, commit SHA, " +
      "status or source (all by default; ci or local narrows it, and each run says local). Status " +
      "is passed, failed, cancelled, incomplete or running; settled is false while the run can " +
      "still change. One row per logical run: a sharded run is collapsed into a single entry, its " +
      "counters over all its shards and per Playwright project variant, like Playwright - a test " +
      "that ran in chromium and firefox counts twice; each job of a CI run that sets a job key is its own run " +
      "(jobKey). attempt and rerunOf say which attempt of its CI run it is and which run it " +
      "re-ran; ciRunUrl links the CI run. Returns summary counters only; use squally-get-run for " +
      "the per-test rows.",
    answers: "Which runs happened — latest, or by branch, commit SHA, status or source. Counters only.",
    cost: "cheap",
  },
  {
    name: "squally-get-run",
    title: "Get one run",
    operationId: "getRun",
    description:
      "One run with its per-test result rows, across every shard - one row per Playwright project " +
      "variant, like Playwright: a test that ran in chromium and firefox is two rows, each named " +
      'with its project ("chromium > cart.spec.ts > adds"). Use this to find out which ' +
      "test is red in a run; the run list carries only the counters. Its status is cancelled " +
      "for a cancelled run (cancellation says how and when), and local says it ran without CI. " +
      "Like squally-find-run it carries settled, jobKey, attempt, rerunOf and ciRunUrl - for a " +
      "re-run, rerunOf.id is the run it re-ran, to compare with. Each test row is the test's " +
      "final attempt: a test that passed only after a retry has status passed and attempts " +
      "above 1, and the errors of its failed attempts come only from squally-debug-failure.",
    answers: "One run with its per-test rows, across all shards. Which test is red.",
    cost: "cheap",
  },
  {
    name: "squally-debug-failure",
    title: "Debug a failing test",
    operationId: "getRunTestAttempts",
    description:
      "Every attempt of one test in one run - one Playwright project variant, by the name " +
      "squally-get-run lists, project included - oldest first, each with the error, the stack and " +
      "the full-context prompt (the same text Copy the full context puts on the clipboard in " +
      "Squally's Debug with AI panel), and the test's annotations (an issue link, a skip or fixme " +
      "reason), its line, worker and start time. This is the " +
      "tool for 'why did this test fail'. If the test name is ambiguous, pass filePath.",
    answers: "Every attempt of one test in one run: error, stack, full-context prompt.",
    cost: "cheap",
  },
  {
    name: "squally-get-test-metrics",
    title: "Get one test's metrics",
    operationId: "getTestMetrics",
    description:
      "One test's numbers over a period, the test once across its Playwright projects: by its " +
      "name without the project, as squally-list-tests lists it, every project counts (projects " +
      "names them, variants carries each project's own numbers); project, or a stored name with " +
      "its project as squally-get-run lists it, counts that project's variant only. A run counts " +
      "as failed when the test failed in any project, and as passed only after a retry when it " +
      "did so in some project and failed in none. " +
      "runs, stability (runs that passed on the first try " +
      "/ runs), flakyRate (runs that passed only after a retry / runs), failureRate (failed " +
      "runs / runs), time lost to retries and failures, the median duration (per run the " +
      "slowest project), its last 20 runs (each with the run " +
      "id squally-find-run gives; runs it skipped included, as result \"skipped\" - shown, " +
      "never counted in runs or any rate) and the branches it ran on. Counts the finished " +
      "runs of the period, CI and local - a sharded run counts once, by its first shard's start - " +
      "without runs that were a mass failure as a whole; source=ci or source=local counts " +
      "only those instead (population names which). A run still in progress counts " +
      "once all its shards have finished, or once the run timeout has passed, with the " +
      "results its shards reported - also when a shard was stopped by the monthly result " +
      "limit. There " +
      "is no verdict - the tool returns the numbers and you judge them. runs = 0 " +
      "with null rates is a valid answer: no counted run of this test in the period. " +
      "Cheap; for one test use this, not squally-list-tests.",
    answers: "One test's stability, flaky rate and failure rate over a period, across its Playwright projects.",
    cost: "cheap",
  },
  {
    name: "squally-list-tests",
    title: "List tests",
    operationId: "listTests",
    description:
      "Every test with a counted run in the period, CI and local (source=ci or source=local narrows it), " +
      "one row per test across its Playwright projects - testName is the name without the " +
      "project, projects names them and variants carries each project's own numbers; project " +
      "(a list) counts only those projects - with the same numbers per test as " +
      "squally-get-test-metrics - runs, stability, flakyRate, failureRate, time lost, median duration - ranked " +
      "worst first by the chosen sort (default: lowest stability). There is no verdict and no " +
      "status - the tool labels no test; you judge the numbers. Moderate - two queries over " +
      "the period, paged; for a single test use squally-get-test-metrics.",
    answers: "Every test with a run in the period, once across its Playwright projects, ranked by stability, flaky rate or failures.",
    cost: "cheap",
  },
  {
    name: "squally-list-errors",
    title: "List errors",
    operationId: "listErrors",
    description:
      "The project's error signatures in a period: failures grouped by fingerprint, with how " +
      "often and how recently each occurred. Answers 'is this failure one instance of something " +
      "that keeps happening' - a grouping no agent can compute from the repository alone. " +
      "Counts finished runs, CI and local, by default (source=ci or source=local for one of them), a sharded run " +
      "once, mass-failure runs included. Each test counts once across its Playwright projects: " +
      "testCount and testNames (names without the project) are tests, projects names the " +
      "projects the error hit. failedRunCount and flakyRunCount say how the runs " +
      "ended: runs in which a test the error hit failed, and runs in which none failed and " +
      "one passed only after a retry. failedCount and flakyCount count (run, test) pairs " +
      "instead - a test once per run however many of its projects the error hit, and a run " +
      "in which the error failed three tests counts three times there.",
    answers: "Error signatures in a period: what keeps failing, grouped, and how its runs ended.",
    cost: "cheap",
  },
];
