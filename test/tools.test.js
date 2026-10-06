// The tool contract, pinned.
//
// read-api-mcp-spec §10e asks for exactly this: "the tool list and each tool's
// schema asserted in a unit test (schemas are a contract with clients and must
// not drift silently)". The shape assertions below are readable; the digest is
// what makes "silently" impossible - a description reworded in the OpenAPI
// document changes what every client sees, and that should require a person to
// look at it and re-pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { toolList, SERVER_NAME } from "../dist/server.js";
import { ANNOTATIONS, TOOLS } from "../dist/tools.js";
import { INSTRUCTIONS } from "../dist/instructions.js";
import { operationFor } from "../dist/openapi.js";
import { validateArgs } from "../dist/validate.js";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/**
 * The seven of §5.1, in the order the spec lists them - with 0.2.0's two
 * replacements in the places of the tools they replaced: squally-get-test-status
 * -> squally-get-test-metrics, squally-list-flaky-tests -> squally-list-tests.
 */
const EXPECTED_NAMES = [
  "squally-list-projects",
  "squally-find-run",
  "squally-get-run",
  "squally-debug-failure",
  "squally-get-test-metrics",
  "squally-list-tests",
  "squally-list-errors",
];

/**
 * name -> [operationId, required params, optional params] from the OpenAPI
 * document, minus each operation's OMITTED_PARAMETERS (src/openapi.ts):
 * perPage and direction for listRuns, perPage for listErrors. listTests keeps
 * its perPage (0.2.0).
 */
const EXPECTED_PARAMS = {
  "squally-list-projects": ["listProjects", [], []],
  "squally-find-run": [
    "listRuns",
    ["projectId"],
    ["days", "branch", "sha", "status", "source", "cursor"],
  ],
  "squally-get-run": ["getRun", ["projectId", "runId"], []],
  "squally-debug-failure": [
    "getRunTestAttempts",
    ["projectId", "runId", "testName"],
    ["filePath"],
  ],
  "squally-get-test-metrics": [
    "getTestMetrics",
    ["projectId", "testName"],
    ["filePath", "days", "branch", "source"],
  ],
  "squally-list-tests": [
    "listTests",
    ["projectId"],
    ["days", "search", "branch", "source", "browser", "sort", "page", "perPage"],
  ],
  "squally-list-errors": ["listErrors", ["projectId"], ["days", "source", "page"]],
};

/** The top-level properties of each operation's 200 response schema. */
const EXPECTED_OUTPUT_KEYS = {
  "squally-list-projects": ["projects"],
  "squally-find-run": [
    "project",
    "window",
    "stableBranch",
    "runs",
    "total",
    "nextCursor",
    "prevCursor",
  ],
  "squally-get-run": ["project", "run", "counts", "tests"],
  "squally-debug-failure": ["project", "run", "test", "attempts"],
  "squally-get-test-metrics": [
    "project",
    "population",
    "days",
    "since",
    "until",
    "branch",
    "testName",
    "filePath",
    "browser",
    "runs",
    "stableRuns",
    "flakyRuns",
    "failedRuns",
    "stability",
    "flakyRate",
    "failureRate",
    "timeLostMs",
    "recentResults",
    "branches",
    "topBranch",
  ],
  "squally-list-tests": [
    "project",
    "population",
    "days",
    "since",
    "until",
    "branch",
    "browser",
    "sort",
    "page",
    "perPage",
    "total",
    "pageCount",
    "items",
  ],
  "squally-list-errors": ["project", "population", "window", "page", "errors", "unfingerprintedCount", "unfinishedRuns"],
};

test("exactly the seven tools of the spec, in order", () => {
  assert.deepEqual(
    toolList().map((t) => t.name),
    EXPECTED_NAMES,
    "the set is closed (§5.1); adding one is a decision, not a convenience",
  );
  assert.deepEqual(TOOLS.map((t) => t.name), EXPECTED_NAMES);
});

test("every tool name follows squally-<verb>-<noun> (§5.0)", () => {
  for (const tool of toolList()) {
    assert.match(
      tool.name,
      /^squally-[a-z]+-[a-z-]+$/,
      `${tool.name} breaks the naming convention`,
    );
  }
});

test("every tool carries the §5.4 annotations", () => {
  assert.deepEqual(ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  for (const tool of toolList()) {
    assert.deepEqual(tool.annotations, ANNOTATIONS, `${tool.name} has different annotations`);
  }
});

test("the metric tools define their numbers in plain words and state there is no verdict", () => {
  // 0.2.0, API 1.0.0-beta.2: the verdict engine is gone, and what replaced it
  // is three fractions of runs. A model that is not told what each one divides
  // by - and that nothing here is a judgement - fills the gap with the old
  // vocabulary. Pinned per sentence rather than by the digest alone, so a
  // reword that drops a definition fails with a readable message.
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  const metrics = byName["squally-get-test-metrics"].description;
  assert.match(metrics, /stability \(runs that passed on the first try \/ runs\)/);
  assert.match(metrics, /flakyRate \(runs that passed only after a retry \/ runs\)/);
  assert.match(metrics, /failureRate \(failed runs \/ runs\)/);
  // 0.3.0, API 1.0.0-beta.6: one run per CI run, counted once its shards have
  // all finished; a mass failure is judged on the run as a whole.
  // API 1.0.0-beta.10: "finished" includes a run the run timeout ended.
  assert.match(metrics, /finished CI runs of the period - a sharded run counts once, by its first shard's start - without runs that were a mass failure as a whole/);
  // 0.4.0, API 1.0.0-beta.8: local runs count when asked for - "local runs
  // never count" was true until then, and an agent reading it would not try.
  assert.match(metrics, /source=local or source=all counts local runs or both instead \(population names which\)/);
  assert.match(INSTRUCTIONS, /pass source=local or source=all to count local runs or both/);
  assert.match(metrics, /each with the run id squally-find-run gives/);
  // 0.4.0, API 1.0.0-beta.7: the newest run is the one an agent asks about,
  // and it is not in the numbers until its last shard has finished.
  // API 1.0.0-beta.10: ... or once the run timeout has passed; beta.11: a shard
  // the monthly result limit stopped is treated like a timed-out one.
  for (const text of [metrics, INSTRUCTIONS]) {
    assert.match(
      text,
      /A run still in progress counts once all its shards have finished, or once the run timeout has passed, with the results its shards reported - also when a shard was stopped by the monthly result limit/
    );
  }
  assert.match(metrics, /There is no verdict/);
  assert.match(metrics, /runs = 0 with null rates is a valid answer/);
  assert.match(metrics, /\bCheap\b/);
  // 0.2.1, API 1.0.0-beta.3: the last 20 runs include skipped ones, which the
  // numbers beside them leave out - a model that counts them gets the rates wrong.
  assert.match(metrics, /last 20 runs \(each with the run id squally-find-run gives; runs it skipped included, as result "skipped" - shown, never counted in runs or any rate\)/);

  const list = byName["squally-list-tests"].description;
  assert.match(list, /There is no verdict/);
  assert.match(list, /\bModerate\b/);
  assert.match(list, /for a single test use squally-get-test-metrics/);

  // The same definitions reach the model once per session, in the
  // instructions - see the pinned sentence at the end of this file.
  assert.match(INSTRUCTIONS, /There is no verdict/);
});

test("no tool and no instruction speaks of a flaky, broken or healthy status any more", () => {
  // The words that named the engine's verdicts. "flaky" survives only as the
  // metric's name (flakyRate, "flaky rate") - never as something a test IS.
  const status = /\bbroken\b|\bhealthy\b|flakiness|verdict engine|engine pass|\bflaky\b(?!\s*rate)/i;
  for (const text of [...toolList().map((t) => t.description), INSTRUCTIONS]) {
    assert.doesNotMatch(text, status, text);
  }
  for (const tool of TOOLS) {
    assert.doesNotMatch(tool.answers, status, tool.name);
  }
});

test("input schemas are the operation's parameters, exactly", () => {
  for (const tool of toolList()) {
    const [, required, optional] = EXPECTED_PARAMS[tool.name];
    const schema = tool.inputSchema;

    assert.equal(schema.type, "object", `${tool.name}`);
    assert.equal(
      schema.additionalProperties,
      false,
      `${tool.name}: an invented parameter must be reported, not dropped`,
    );
    assert.deepEqual(
      Object.keys(schema.properties),
      [...required, ...optional],
      `${tool.name}: properties`,
    );
    assert.deepEqual(schema.required ?? [], required, `${tool.name}: required`);
  }
});

test("each tool calls the operation the table names", () => {
  for (const tool of TOOLS) {
    assert.equal(tool.operationId, EXPECTED_PARAMS[tool.name][0], tool.name);
  }
  assert.equal(operationFor("listTests").path, "/projects/{projectId}/tests");
  assert.equal(operationFor("getTestMetrics").path, "/projects/{projectId}/tests/{testName}/metrics");
});

test("path parameters are all required, query parameters never are", () => {
  // The rule behind the table above: a missing path parameter cannot produce a
  // URL at all, so it must fail here rather than as a 404.
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  assert.deepEqual(byName["squally-debug-failure"].inputSchema.required, [
    "projectId",
    "runId",
    "testName",
  ]);
  assert.equal(byName["squally-debug-failure"].inputSchema.properties.filePath.type, "string");
  assert.deepEqual(byName["squally-get-test-metrics"].inputSchema.required, [
    "projectId",
    "testName",
  ]);
});

test("enums, defaults and bounds survive from the document into the input schema", () => {
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  const runs = byName["squally-find-run"].inputSchema.properties;
  // 14 joined the periods with API 1.0.0-beta.2. Since 1.0.0-beta.5 every
  // period defaults to 30.
  assert.deepEqual(runs.days.enum, [7, 14, 30, 90]);
  assert.equal(runs.days.default, 30);
  // 0.5.0, API 1.0.0-beta.14: the dashboard's five, and the source filter -
  // all by default, unlike the counting tools, because the list counts nothing.
  assert.deepEqual(runs.status.enum, ["passed", "failed", "cancelled", "incomplete", "running"]);
  assert.deepEqual(runs.source.enum, ["ci", "local", "all"]);
  assert.equal(runs.source.default, "all");
  assert.equal(runs.sha.pattern, "^[0-9a-fA-F]{4,40}$");
  assert.equal(runs.branch.maxLength, 200);

  // Passed through unchanged, defaults included: the tool sends what the
  // model gave and leaves every default to the API.
  const tests = byName["squally-list-tests"].inputSchema.properties;
  assert.deepEqual(tests.days.enum, [7, 14, 30, 90]);
  assert.equal(tests.days.default, 30);
  assert.deepEqual(tests.sort.enum, ["stability", "flakyRate", "failureRate", "runs", "timeLost"]);
  assert.equal(tests.sort.default, "stability");
  assert.equal(tests.page.minimum, 1);
  assert.equal(tests.perPage.minimum, 1);
  assert.equal(tests.perPage.maximum, 100);
  assert.equal(tests.perPage.default, 50);
  for (const text of ["search", "branch", "browser"]) {
    assert.equal(tests[text].minLength, 1, text);
    assert.equal(tests[text].maxLength, 200, text);
  }

  const metrics = byName["squally-get-test-metrics"].inputSchema.properties;
  assert.deepEqual(metrics.days.enum, [7, 14, 30, 90]);
  assert.equal(metrics.days.default, 30);
  // An empty filePath is a value (a test with no file), so nothing may forbid it.
  assert.equal(metrics.filePath.minLength, undefined);
});

test("perPage is offered by squally-list-tests only; direction by no tool", () => {
  // 0.1.3: a fixed page size of 10 (the API's default) and forward paging
  // only - OMITTED_PARAMETERS in src/openapi.ts. Refused rather than dropped,
  // like any argument the model made up; never forwarded to the API.
  for (const [tool, operationId, extra] of [
    ["squally-find-run", "listRuns", { perPage: 50 }],
    ["squally-find-run", "listRuns", { direction: "prev" }],
    ["squally-list-errors", "listErrors", { perPage: 50 }],
  ]) {
    const schema = toolList().find((t) => t.name === tool).inputSchema;
    for (const name of Object.keys(extra)) assert.equal(name in schema.properties, false, `${tool} offers ${name}`);
    const result = validateArgs(operationFor(operationId), { projectId: "p", ...extra });
    assert.equal(result.ok, false, `${tool} accepted ${JSON.stringify(extra)}`);
  }
  // 0.2.0: the tests list keeps it, within the API's bounds.
  const tests = operationFor("listTests");
  assert.equal(validateArgs(tests, { projectId: "p", perPage: 100 }).ok, true);
  assert.equal(validateArgs(tests, { projectId: "p", perPage: 1 }).ok, true);
  const tooMany = validateArgs(tests, { projectId: "p", perPage: 101 });
  assert.equal(tooMany.ok, false, "perPage above 100 must be refused here, not by the API");
  assert.match(tooMany.message, /perPage/);
  assert.equal(validateArgs(tests, { projectId: "p", perPage: 0 }).ok, false);
  // The cursor text no longer sends the model to direction=prev.
  const cursor = toolList().find((t) => t.name === "squally-find-run").inputSchema.properties.cursor;
  assert.doesNotMatch(cursor.description, /direction/);
  assert.match(cursor.description, /nextCursor/);
});

test("output schemas are the operation's 200 response schema", () => {
  for (const tool of toolList()) {
    const schema = tool.outputSchema;
    assert.ok(schema, `${tool.name} has no outputSchema`);
    assert.equal(schema.type, "object", `${tool.name}: outputSchema must be an object`);
    assert.equal(
      JSON.stringify(schema).includes("$ref"),
      false,
      `${tool.name}: outputSchema still carries a $ref - a client cannot resolve it`,
    );
    assert.deepEqual(
      Object.keys(schema.properties),
      EXPECTED_OUTPUT_KEYS[tool.name],
      `${tool.name}: output properties`,
    );
  }
});

test("the run tools count flaky, not recovered (API 1.0.0-beta.2)", () => {
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  const runCounts = byName["squally-find-run"].outputSchema.properties.runs.items.properties.counts;
  const oneRun = byName["squally-get-run"].outputSchema.properties.counts;
  for (const counts of [runCounts, oneRun]) {
    assert.deepEqual(Object.keys(counts.properties), ["total", "passed", "failed", "skipped", "flaky"]);
    assert.deepEqual(counts.required, ["total", "passed", "failed", "skipped", "flaky"]);
  }
});

test("a recent result can be skipped, in both metric tools (API 1.0.0-beta.3)", () => {
  // Additive in beta.3: a run whose final attempt skipped is listed in
  // recentResults and counted nowhere. The enum is pinned so a client that
  // validates structured output learns of the next new value from a failing test,
  // not from a rejected response.
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  const one = byName["squally-get-test-metrics"].outputSchema.properties.recentResults;
  const each = byName["squally-list-tests"].outputSchema.properties.items.items.properties.recentResults;
  for (const recent of [one, each]) {
    assert.deepEqual(recent.items.properties.result.enum, ["stable", "flaky", "failed", "skipped"]);
  }
});

test("testName and filePath say NOT to URL-encode - the 24.09. defect", () => {
  // A tool argument is not a URL. The OpenAPI document tells an HTTP caller to
  // percent-encode the name, and in the recorded Claude Code session of 24.09.
  // the model did exactly that - src/api.ts then encoded it a second time and
  // an existing test came back as test_not_found. These two descriptions are
  // overridden for that reason and the wording is pinned here, because it is
  // the only thing standing between the model and the same mistake.
  const withName = toolList().filter((t) => t.inputSchema.properties.testName);
  assert.deepEqual(
    withName.map((t) => t.name),
    ["squally-debug-failure", "squally-get-test-metrics"],
  );

  for (const tool of withName) {
    const { testName, filePath } = tool.inputSchema.properties;

    assert.match(
      testName.description,
      /Pass the name exactly as shown in Squally; do not URL-encode, the server does\./,
      `${tool.name}: testName`,
    );
    assert.match(
      filePath.description,
      /Pass it exactly as shown in Squally; do not URL-encode, the server does\./,
      `${tool.name}: filePath`,
    );

    // The document's own wording must be gone, not merely contradicted: two
    // instructions in one description is how the model picked the wrong one.
    for (const property of [testName, filePath]) {
      assert.equal(
        /URL-encode it/.test(property.description),
        false,
        `${tool.name}: the document's encode instruction survived`,
      );
      assert.equal(
        property.description.includes("%2F"),
        false,
        `${tool.name}: the description still names %2F`,
      );
    }
  }
});

test("the whole tool list is digest-pinned - a silent reword fails here", () => {
  // Re-pin deliberately after re-vendoring the OpenAPI document, and say in
  // the commit what changed for clients.
  //
  // 0.1.3: a411646bde3a53c7 -> 75c28613460d6cdc. perPage left
  // squally-find-run, squally-list-flaky-tests and squally-list-errors,
  // direction left squally-find-run, and squally-find-run's cursor description
  // no longer mentions direction (OMITTED_PARAMETERS, PARAMETER_DESCRIPTIONS).
  // Nothing else in the list changed - diffed against the published 0.1.2.
  //
  // 0.1.4: 75c28613460d6cdc -> 3002b7484ca91d58. Re-vendored after
  // squally-app 68d9ca7 (25.09.): squally-list-flaky-tests' output schema
  // gains runsInWindow (integer, required) and a description on
  // runsConsidered. Three paths, all in that one output schema - no input
  // schema, no other tool; diffed against the 0.1.3 list.
  //
  // 0.2.0: 3002b7484ca91d58 -> 4c899fd36e0899fc. Re-vendored from API 1.0.0-beta.2
  // (squally-app 229f7df, 25.09.2026). squally-get-test-status and
  // squally-list-flaky-tests are gone; squally-get-test-metrics and
  // squally-list-tests take their places. Of the five tools that stay:
  // squally-find-run and squally-list-errors accept days=14 (enum 7|14|30|90),
  // and the counts of squally-find-run's rows and of squally-get-run are
  // total/passed/failed/skipped/FLAKY where the fifth was `recovered` (now with
  // a description). Nothing else in them changed - diffed against 0.1.4.
  //
  // 0.2.1: 4c899fd36e0899fc -> ac0be4f17620ae6f. Re-vendored from API
  // 1.0.0-beta.3 (squally-app 6a85adf, 26.09.2026). In the output schemas of
  // squally-get-test-metrics and squally-list-tests, recentResults[].result
  // gains the enum value "skipped" and it and recentResults have new
  // descriptions; squally-get-test-metrics' description says the last 20 runs
  // include skipped ones, counted nowhere. No input schema and no other tool
  // changed - diffed against 0.2.0.
  //
  // 0.2.2: ac0be4f17620ae6f -> 1845c9fe0a471f4c. Re-vendored from API
  // 1.0.0-beta.4 (squally-app 1e8fd4c, 27.09.2026). Output schemas only, all
  // additions: squally-find-run's rows and squally-get-run's run gain cancelled
  // (boolean) and cancellation ({source, at, byUserId} | null, source a plain
  // string - no enum), both required; squally-get-run's tests and
  // squally-debug-failure's attempts gain timedOut and timeoutMs (nullable,
  // required). New descriptions on commitSha, testedRevision, status and
  // finishedAt in those two tools, and on squally-find-run's sha and status
  // inputs. No other input schema and no other tool changed - diffed against
  // 0.2.1.
  //
  // 0.2.3: 1845c9fe0a471f4c -> 135a1d30948cf94c. Re-vendored from API
  // 1.0.0-beta.5 (squally-app 215e6c5, 01.10.2026). Two values, both input
  // schemas: the `days` default of squally-list-tests and
  // squally-get-test-metrics is 30, where it was 14. No output schema, no
  // description and no other tool changed - diffed against 0.2.2.
  //
  // 0.3.0: 135a1d30948cf94c -> f2370af299aacdde. Re-vendored from API
  // 1.0.0-beta.6 (squally-app, 01.10.2026; Breaking). Output schemas of
  // squally-get-test-metrics and squally-list-tests: population's const is
  // "ci_groups_finished_not_mass_failure" (was "ci_completed_not_excluded"),
  // with new descriptions on population, runs, recentResults[].runId and
  // recentResults[].result. Both tools' descriptions say what is counted now
  // (CI runs whose shards all finished, once each) and that recentResults
  // carry the run id squally-find-run gives. No input schema and no other tool
  // changed - diffed against 0.2.3.
  //
  // 0.4.0 (first half): f2370af299aacdde -> a795c8c20452b574. Re-vendored from API
  // 1.0.0-beta.7 (squally-app S2 of block 1, 02.10.2026), which changes only
  // /overview - no tool calls it - and info.version: the seven operations'
  // parameters and 200 schemas are identical, and the list re-vendored with
  // the 0.3.0 texts still digests to f2370af299aacdde (measured). The new
  // digest is one clause in squally-get-test-metrics' description: a run still
  // in progress counts once all its shards have finished.
  //
  // 0.4.0 (second half): a795c8c20452b574 -> 030a7b353fcde855. Re-vendored from
  // API 1.0.0-beta.9 (squally-app S3, 03.10.2026; beta.8 the source filter).
  // Input schemas: squally-get-test-metrics, squally-list-tests and
  // squally-list-errors take `source` (ci default, local, all). Output schemas:
  // `population` an enum on the two metric tools (local_ and all_ values
  // beside the ci one); squally-list-errors gains population, unfinishedRuns
  // and per error failedCount, flakyCount and massFailureRunCount, loses
  // isNew, and its runCount counts runs, not shards. Descriptions: the metric
  // tools and the instructions say local runs count when asked for (they said
  // they never count), squally-list-errors says what it counts. No other tool
  // changed - diffed against the 0.4.0 first half.
  //
  // Unreleased: 030a7b353fcde855 -> be7570d83ef0a765. Re-vendored from API
  // 1.0.0-beta.10 (squally-app, the timeout rule, 03.10.2026; behaviour change
  // only). No shape changed: the document without descriptions is identical to
  // beta.9, and every parameter and 200 schema of the seven operations too. The
  // re-vendor alone moves the digest to 0ec18d6d9d3f7f0c (measured): the
  // output-schema descriptions of population and unfinishedRuns say a run the
  // run timeout ended counts. The rest is squally-get-test-metrics'
  // description, which says the same.
  //
  // Unreleased: be7570d83ef0a765 -> b5f33880241a0860. Re-vendored from API
  // 1.0.0-beta.11 (squally-app, the monthly result limit treated like a
  // timeout, 03.10.2026; descriptions only). No shape changed: the document
  // without descriptions and info is identical to beta.10. The re-vendor alone
  // gives 6b3f7d137c804423 (measured) - the same output-schema descriptions
  // name the limit. The rest is squally-get-test-metrics' description: "with
  // the results its shards reported - also when a shard was stopped by the
  // monthly result limit", where it said "with the shards that finished".
  //
  // 0.5.0: b5f33880241a0860 -> 3c85144f5adf33f3. Re-vendored from API
  // 1.0.0-beta.14 (squally-app S4.5, 04.10.2026; beta.12 and beta.13
  // included). Breaking for the two run tools: status is one of passed,
  // failed, cancelled, incomplete, running on squally-find-run's rows,
  // squally-get-run's run and each of its shards, never null; cancelled
  // (boolean) is gone, local (boolean) is new and required; squally-find-run
  // takes source (ci, local, all - default all) and status takes all five. The
  // re-vendor alone gives be2756c18a3318e1 (measured). The rest is the texts:
  // squally-find-run says it finds CI and local runs, names the five statuses
  // and that a sharded run's counters cover all its shards; squally-get-run
  // says a cancelled run is cancelled and what local means.
  //
  // 0.6.0: 3c85144f5adf33f3 -> 106184c19163cee2. Re-vendored from API
  // 1.0.0-beta.15 (squally-app block 1b S5, 06.10.2026; beta.14's
  // document-only entry included). squally-find-run's rows and
  // squally-get-run's run gain settled (boolean), jobKey, attempt, rerunOf
  // ({id, runNumber}) and ciRunUrl - all required, the last four nullable;
  // shards.expected gains its description. The re-vendor alone gives
  // 9612c1aacf13a1a8 (measured). The rest is the texts: squally-find-run names
  // settled, the job key, attempt, rerunOf and ciRunUrl; squally-get-run says
  // it carries them and what rerunOf.id is for; squally-get-test-metrics says
  // "no counted run", not "no counted CI run" (it counts local runs on request).
  assert.equal(
    digest(toolList()),
    "106184c19163cee2",
    "the tool list changed. If that was intended (a re-vendored OpenAPI document, " +
      "a reworded description), update this digest in the same commit.",
  );
});

test("the server identifies as squally and carries the instructions", () => {
  assert.equal(SERVER_NAME, "squally");
  assert.equal(
    INSTRUCTIONS,
    "Start with squally-list-projects; every other tool needs a projectId from it. " +
      "For one test, use squally-get-test-metrics, not squally-list-tests. " +
      "Test metrics count the finished CI runs of the period - a sharded run counts once - " +
      "without runs that were a mass failure as a whole; pass source=local or source=all " +
      "to count local runs or both. A run still in progress counts once all its shards have " +
      "finished, or once the run timeout has passed, with the results its shards reported - " +
      "also when a shard was stopped by the monthly result limit. " +
      "stability = runs that passed on the " +
      "first try / runs; flakyRate = runs that passed only after a retry / runs; " +
      "failureRate = failed runs / runs. There is no verdict: the tools return numbers, " +
      "and you judge them. If a test name is ambiguous, repeat with filePath from the " +
      "error. A run's status is passed, failed, cancelled, incomplete or running; " +
      "a run that is not settled can still change. Each job of a CI run that sets a " +
      "job key is its own run (jobKey). " +
      "Errors carry a code and an action; follow the action.",
  );
});

test("0.5.0: a run's status is the dashboard's five words, local is there and cancelled is gone", () => {
  // API 1.0.0-beta.14 (squally-app S4.5): squally-find-run's rows and
  // squally-get-run's run - and each shard of it - say passed, failed,
  // cancelled, incomplete or running, never null; the cancelled boolean went,
  // cancellation stayed; local is new and required.
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  const FIVE = ["passed", "failed", "cancelled", "incomplete", "running"];
  const listed = byName["squally-find-run"].outputSchema.properties.runs.items;
  const run = byName["squally-get-run"].outputSchema.properties.run;
  for (const [name, schema] of [["squally-find-run", listed], ["squally-get-run", run]]) {
    assert.deepEqual(schema.properties.status.enum, FIVE, name);
    assert.equal(schema.properties.cancelled, undefined, `${name}: the cancelled flag is gone`);
    assert.ok(schema.properties.cancellation, `${name}: cancellation stays`);
    assert.equal(schema.properties.local.type, "boolean", name);
    assert.ok(schema.required.includes("local") && !schema.required.includes("cancelled"), name);
  }
  const shard = run.properties.shards.anyOf.find((s) => s.type === "object").properties.received.items;
  assert.deepEqual(shard.properties.status.enum, FIVE, "each shard in the same words");
  assert.match(byName["squally-find-run"].description, /CI and local alike/);
  assert.match(byName["squally-find-run"].description, /passed, failed, cancelled, incomplete or running/);
  assert.match(byName["squally-get-run"].description, /cancelled for a cancelled run/);
});

test("0.6.0: the run tools carry settled, jobKey, attempt, rerunOf and ciRunUrl", () => {
  // API 1.0.0-beta.15 (squally-app block 1b S5): what the run page's header
  // shows beside the status. All five are required; settled is a boolean, the
  // others are null when they do not apply.
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  const listed = byName["squally-find-run"].outputSchema.properties.runs.items;
  const run = byName["squally-get-run"].outputSchema.properties.run;
  const nullable = (property, type) => property.anyOf?.some((s) => s.type === type) && property.anyOf.some((s) => s.type === "null");
  for (const [name, schema] of [["squally-find-run", listed], ["squally-get-run", run]]) {
    for (const field of ["settled", "jobKey", "attempt", "rerunOf", "ciRunUrl"]) {
      assert.ok(schema.required.includes(field), `${name}: ${field} is required`);
    }
    assert.equal(schema.properties.settled.type, "boolean", name);
    assert.ok(nullable(schema.properties.jobKey, "string"), `${name}: jobKey`);
    assert.ok(nullable(schema.properties.attempt, "integer"), `${name}: attempt`);
    assert.ok(nullable(schema.properties.ciRunUrl, "string"), `${name}: ciRunUrl`);
    const rerunOf = schema.properties.rerunOf.anyOf.find((s) => s.type === "object");
    assert.deepEqual(Object.keys(rerunOf.properties).sort(), ["id", "runNumber"], `${name}: rerunOf`);
  }
  assert.match(byName["squally-find-run"].description, /settled is false while the run can still change/);
  assert.match(byName["squally-find-run"].description, /its own run \(jobKey\)/);
  assert.match(byName["squally-get-run"].description, /rerunOf\.id is the run it re-ran/);
  assert.match(INSTRUCTIONS, /a run that is not settled can still change/);
});
