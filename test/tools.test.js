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

/** The seven of §5.1, in the order the spec lists them. */
const EXPECTED_NAMES = [
  "squally-list-projects",
  "squally-find-run",
  "squally-get-run",
  "squally-debug-failure",
  "squally-get-test-status",
  "squally-list-flaky-tests",
  "squally-list-errors",
];

/**
 * name -> [operationId, required params, optional params] from the OpenAPI
 * document, minus OMITTED_PARAMETERS (perPage, direction - src/openapi.ts).
 */
const EXPECTED_PARAMS = {
  "squally-list-projects": ["listProjects", [], []],
  "squally-find-run": [
    "listRuns",
    ["projectId"],
    ["days", "branch", "sha", "status", "cursor"],
  ],
  "squally-get-run": ["getRun", ["projectId", "runId"], []],
  "squally-debug-failure": [
    "getRunTestAttempts",
    ["projectId", "runId", "testName"],
    ["filePath"],
  ],
  "squally-get-test-status": ["getTestStatus", ["projectId", "testName"], ["filePath"]],
  "squally-list-flaky-tests": [
    "listFlakyTests",
    ["projectId"],
    ["status", "sort", "search", "page"],
  ],
  "squally-list-errors": ["listErrors", ["projectId"], ["days", "page"]],
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
  "squally-get-test-status": [
    "project",
    "test",
    "status",
    "awaitingFirstWrite",
    "activeSignals",
    "labels",
  ],
  "squally-list-flaky-tests": [
    "project",
    "windowDays",
    "sort",
    "page",
    "tests",
    "gatheringDataCount",
  ],
  "squally-list-errors": ["project", "window", "page", "errors", "unfingerprintedCount"],
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

test("the two cost sentences are in the tool descriptions, in those words", () => {
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  // §5.1 does not merely say these tools differ in cost - it says the
  // description says so "in those words". The model chooses between them on
  // this text alone.
  assert.match(byName["squally-get-test-status"].description, /\bCheap\b/);
  assert.match(byName["squally-get-test-status"].description, /one findUnique/);
  assert.match(byName["squally-list-flaky-tests"].description, /\bExpensive\b/);
  assert.match(byName["squally-list-flaky-tests"].description, /engine pass/);
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
});

test("enums and bounds survive from the document into the input schema", () => {
  const byName = Object.fromEntries(toolList().map((t) => [t.name, t]));
  const runs = byName["squally-find-run"].inputSchema.properties;
  assert.deepEqual(runs.days.enum, [7, 30, 90]);
  assert.equal(runs.days.default, 30);
  assert.deepEqual(runs.status.enum, ["passed", "failed"]);
  assert.equal(runs.sha.pattern, "^[0-9a-fA-F]{4,40}$");
  assert.equal(runs.branch.maxLength, 200);

  const flaky = byName["squally-list-flaky-tests"].inputSchema.properties;
  assert.deepEqual(flaky.sort.enum, ["timeLost", "rate", "impact"]);
  assert.equal(flaky.page.minimum, 1);
});

test("perPage and direction are not offered, and refused when sent anyway", () => {
  // 0.1.3: a fixed page size of 10 (the API's default) and forward paging
  // only - OMITTED_PARAMETERS in src/openapi.ts. Refused rather than dropped,
  // like any argument the model made up; never forwarded to the API.
  for (const [tool, operationId, extra] of [
    ["squally-find-run", "listRuns", { perPage: 50 }],
    ["squally-find-run", "listRuns", { direction: "prev" }],
    ["squally-list-flaky-tests", "listFlakyTests", { perPage: 50 }],
    ["squally-list-errors", "listErrors", { perPage: 50 }],
  ]) {
    const schema = toolList().find((t) => t.name === tool).inputSchema;
    for (const name of Object.keys(extra)) assert.equal(name in schema.properties, false, `${tool} offers ${name}`);
    const result = validateArgs(operationFor(operationId), { projectId: "p", ...extra });
    assert.equal(result.ok, false, `${tool} accepted ${JSON.stringify(extra)}`);
  }
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

test("testName and filePath say NOT to URL-encode - the 24.09. defect", () => {
  // A tool argument is not a URL. The OpenAPI document tells an HTTP caller to
  // percent-encode the name, and in the recorded Claude Code session of 24.09.
  // the model did exactly that - src/api.ts then encoded it a second time and
  // an existing test came back as test_not_found. These two descriptions are
  // overridden for that reason and the wording is pinned here, because it is
  // the only thing standing between the model and the same mistake.
  const withName = toolList().filter((t) => t.inputSchema.properties.testName);
  assert.equal(withName.length, 2, "squally-debug-failure and squally-get-test-status");

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
  assert.equal(
    digest(toolList()),
    "75c28613460d6cdc",
    "the tool list changed. If that was intended (a re-vendored OpenAPI document, " +
      "a reworded description), update this digest in the same commit.",
  );
});

test("the server identifies as squally and carries the instructions", () => {
  assert.equal(SERVER_NAME, "squally");
  assert.equal(
    INSTRUCTIONS,
    "Start with squally-list-projects; every other tool needs a projectId from it. " +
      "For one test, use squally-get-test-status (cheap), not squally-list-flaky-tests " +
      "(expensive, one engine pass). If a test name is ambiguous, repeat with filePath " +
      "from the error. Errors carry a code and an action; follow the action.",
  );
});
