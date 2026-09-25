// URL building, argument validation, and every shape an answer can take -
// all against a mocked fetch, so the suite needs no network and no key.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUrl, callOperation, KEY_EXPIRY_HEADER } from "../dist/api.js";
import { loadDocument, operationFor } from "../dist/openapi.js";
import { expiryLine, toolResult, RATE_LIMITED_TEXT } from "../dist/result.js";
import { validateArgs } from "../dist/validate.js";

const CONFIG = {
  apiBase: "https://app.squally.dev/api/v1",
  apiKey: "sqly_ro_" + "a".repeat(40),
  userAgent: "squally-mcp/0.1.0",
};

const ERROR_CODES = loadDocument().errorCodes;

/** A fetch stand-in that records the one call it is given. */
function stubFetch(answer) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetcher, calls };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// --- URLs -----------------------------------------------------------------

test("path parameters are substituted and query parameters appended", () => {
  const url = buildUrl(CONFIG.apiBase, operationFor("listRuns"), {
    projectId: "p1",
    branch: "main",
    days: 7,
  });
  // Query order follows the OpenAPI parameter order (days before branch), not
  // the order the caller happened to pass them - one stable spelling per
  // request, which keeps a proxy or an access log readable.
  assert.equal(url, "https://app.squally.dev/api/v1/projects/p1/runs?days=7&branch=main");
});

test('a test name with "/" is encoded as %2F', () => {
  // The measurement in read-api-mcp-spec §4.2: %2F matches the route and
  // arrives decoded; an unencoded slash is a different path and 404s.
  const url = buildUrl(CONFIG.apiBase, operationFor("getTestMetrics"), {
    projectId: "p1",
    testName: "checkout/completes payment",
  });
  assert.equal(
    url,
    "https://app.squally.dev/api/v1/projects/p1/tests/checkout%2Fcompletes%20payment/metrics",
  );
  assert.equal(url.includes("/checkout/completes"), false);
});

test("a test name is one path segment, whatever it contains", () => {
  // The raw name goes in; encodeURIComponent makes it exactly one segment, so
  // "/", "?", "#" and "%" cannot end the segment, start a query or be read as
  // an escape that was never there.
  const url = buildUrl(CONFIG.apiBase, operationFor("getTestMetrics"), {
    projectId: "p1",
    testName: "chromium > a/b.spec.ts > 50% off? #1",
  });
  assert.equal(
    url,
    "https://app.squally.dev/api/v1/projects/p1/tests/" +
      "chromium%20%3E%20a%2Fb.spec.ts%20%3E%2050%25%20off%3F%20%231/metrics",
  );
});

test("other path values are encoded too", () => {
  const url = buildUrl(CONFIG.apiBase, operationFor("getRun"), {
    projectId: "a b",
    runId: "r/1",
  });
  assert.equal(url, "https://app.squally.dev/api/v1/projects/a%20b/runs/r%2F1");
});

test("an omitted or empty query parameter is not sent at all", () => {
  const url = buildUrl(CONFIG.apiBase, operationFor("listRuns"), {
    projectId: "p1",
    branch: "",
    sha: undefined,
  });
  assert.equal(url, "https://app.squally.dev/api/v1/projects/p1/runs");
});

test("an empty filePath IS sent - it names a test with no file", () => {
  // The one exception to the rule above (EMPTY_IS_A_VALUE in src/api.ts): the
  // API tells `?filePath=` apart from no filePath at all, and "" is the only
  // way to ask for a test that has no file.
  for (const operationId of ["getTestMetrics", "getRunTestAttempts"]) {
    const url = buildUrl(CONFIG.apiBase, operationFor(operationId), {
      projectId: "p1",
      runId: "r1",
      testName: "t",
      filePath: "",
    });
    assert.match(url, /\?filePath=$/, operationId);
  }
  // Absent stays absent.
  const absent = buildUrl(CONFIG.apiBase, operationFor("getTestMetrics"), {
    projectId: "p1",
    testName: "t",
  });
  assert.equal(absent, "https://app.squally.dev/api/v1/projects/p1/tests/t/metrics");
});

test("the tests list passes every argument through unchanged, in document order", () => {
  const url = buildUrl(CONFIG.apiBase, operationFor("listTests"), {
    perPage: 100,
    sort: "flakyRate",
    projectId: "p1",
    days: 30,
    browser: "chromium",
    branch: "feature/a b",
    search: "check out",
    page: 2,
  });
  assert.equal(
    url,
    "https://app.squally.dev/api/v1/projects/p1/tests" +
      "?days=30&search=check+out&branch=feature%2Fa+b&browser=chromium&sort=flakyRate&page=2&perPage=100",
  );
});

test("the request carries the bearer key, the user agent and accepts JSON", async () => {
  const { fetcher, calls } = stubFetch(jsonResponse(200, { projects: [] }));
  await callOperation(CONFIG, operationFor("listProjects"), {}, fetcher);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${CONFIG.apiKey}`);
  assert.equal(calls[0].init.headers["user-agent"], "squally-mcp/0.1.0");
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(calls[0].init.method, "GET");
});

// --- Arguments ------------------------------------------------------------

test("a missing required argument is refused before any request", () => {
  const result = validateArgs(operationFor("getRun"), { projectId: "p1" });
  assert.equal(result.ok, false);
  assert.match(result.message, /runId/);
});

test("a value outside the enum is refused, naming the parameter", () => {
  const result = validateArgs(operationFor("listRuns"), { projectId: "p1", days: 5 });
  assert.equal(result.ok, false);
  assert.match(result.message, /days/);
});

test("an invented argument is reported rather than dropped", () => {
  const result = validateArgs(operationFor("listRuns"), { projectId: "p1", brunch: "main" });
  assert.equal(result.ok, false, "a dropped parameter reads as an empty result to the agent");
});

test("valid arguments pass through unchanged", () => {
  const result = validateArgs(operationFor("listRuns"), {
    projectId: "p1",
    days: 30,
    status: "failed",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.args, { projectId: "p1", days: 30, status: "failed" });
});

// --- Answers --------------------------------------------------------------

test("a 200 becomes structuredContent carrying the API's JSON unchanged", async () => {
  const body = { projects: [{ id: "p1", name: "web" }] };
  const { fetcher } = stubFetch(jsonResponse(200, body));
  const api = await callOperation(CONFIG, operationFor("listProjects"), {}, fetcher);
  const result = toolResult(api, ERROR_CODES, CONFIG.apiBase);

  assert.deepEqual(result.structuredContent, body);
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), body);
});

test("an API error carries the sentence, the code and the action", async () => {
  const { fetcher } = stubFetch(
    jsonResponse(400, {
      error: "Several tests have this name. Pass ?filePath= with one of: a.spec.ts, b.spec.ts.",
      code: "ambiguous_test",
    }),
  );
  const api = await callOperation(CONFIG, operationFor("getTestMetrics"), {
    projectId: "p1",
    testName: "t",
  }, fetcher);
  const result = toolResult(api, ERROR_CODES, CONFIG.apiBase);

  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /Several tests have this name/);
  assert.match(text, /Error code: ambiguous_test/);
  assert.match(text, /What to do: .*filePath/);
});

test("ambiguous_test lists the files as the exact filePath values to retry with", async () => {
  // The sentence names them in HTTP terms, and writes a test with no file as
  // "(no file)" - which the model must not copy: that argument is "".
  const { fetcher } = stubFetch(
    jsonResponse(400, {
      error:
        "Several tests have this name. Pass ?filePath= with one of: " +
        "tests/a.spec.ts, tests/nested/b.spec.ts, (no file).",
      code: "ambiguous_test",
    }),
  );
  const api = await callOperation(CONFIG, operationFor("getTestMetrics"), {
    projectId: "p1",
    testName: "t",
  }, fetcher);
  const lines = toolResult(api, ERROR_CODES, CONFIG.apiBase).content[0].text.split("\n");

  assert.equal(lines[0], api.message, "the API's sentence comes first, verbatim");
  assert.equal(lines[1], "Error code: ambiguous_test");
  assert.equal(
    lines[2],
    'Retry with filePath set to exactly one of: "tests/a.spec.ts", "tests/nested/b.spec.ts", ' +
      '"" (the test with no file)',
  );
  assert.match(lines[3], /^What to do: /);
});

test("a reworded ambiguous_test sentence still reaches the model, without the parsed line", async () => {
  const { fetcher } = stubFetch(
    jsonResponse(400, { error: "That name is used by several tests.", code: "ambiguous_test" }),
  );
  const api = await callOperation(CONFIG, operationFor("getTestMetrics"), {
    projectId: "p1",
    testName: "t",
  }, fetcher);
  const text = toolResult(api, ERROR_CODES, CONFIG.apiBase).content[0].text;
  assert.match(text, /^That name is used by several tests\./);
  assert.doesNotMatch(text, /Retry with filePath/);
  assert.match(text, /What to do: /);
});

test("test_not_found passes through as the API sent it, with its action", async () => {
  const { fetcher } = stubFetch(
    jsonResponse(404, { error: "No test with this name in this project.", code: "test_not_found" }),
  );
  const api = await callOperation(CONFIG, operationFor("getTestMetrics"), {
    projectId: "p1",
    testName: "nope",
  }, fetcher);
  const result = toolResult(api, ERROR_CODES, CONFIG.apiBase);
  assert.equal(result.isError, true);
  assert.equal(
    result.content[0].text,
    "No test with this name in this project.\n" +
      "Error code: test_not_found\n" +
      `What to do: ${ERROR_CODES.get("test_not_found").action}`,
  );
});

test("every code in the document maps to an action", () => {
  // The server instructions tell the model "errors carry a code and an action;
  // follow the action". This is the check that there is always one to follow.
  for (const [code, entry] of ERROR_CODES) {
    assert.ok(entry.action && entry.action.length > 0, `${code} has no action`);
  }
});

test("a 429 has no body and gets the one fixed sentence", async () => {
  const { fetcher } = stubFetch(new Response("", { status: 429 }));
  const api = await callOperation(CONFIG, operationFor("listProjects"), {}, fetcher);
  const result = toolResult(api, ERROR_CODES, CONFIG.apiBase);
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, RATE_LIMITED_TEXT);
  assert.match(result.content[0].text, /wait 60 seconds/);
});

test("an error without a body still says something useful", async () => {
  const { fetcher } = stubFetch(new Response("", { status: 503 }));
  const api = await callOperation(CONFIG, operationFor("listProjects"), {}, fetcher);
  const result = toolResult(api, ERROR_CODES, CONFIG.apiBase);
  assert.match(result.content[0].text, /HTTP 503/);
  assert.match(result.content[0].text, /backoff/);
});

test("a network failure names the base URL that was tried", async () => {
  const { fetcher } = stubFetch(new TypeError("fetch failed"));
  const api = await callOperation(CONFIG, operationFor("listProjects"), {}, fetcher);
  const result = toolResult(api, ERROR_CODES, CONFIG.apiBase);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Could not reach the Squally API/);
  assert.match(result.content[0].text, /https:\/\/app\.squally\.dev\/api\/v1/);
});

test("a 200 that is not JSON reads as unreachable, not as a parse error", async () => {
  const { fetcher } = stubFetch(
    new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }),
  );
  const api = await callOperation(CONFIG, operationFor("listProjects"), {}, fetcher);
  assert.equal(api.kind, "unreachable");
});

// --- Key expiry -----------------------------------------------------------

test("the expiry header adds one line, and only then", async () => {
  const withHeader = stubFetch(
    jsonResponse(200, { projects: [] }, { [KEY_EXPIRY_HEADER]: "2026-10-01T00:00:00.000Z" }),
  );
  let api = await callOperation(CONFIG, operationFor("listProjects"), {}, withHeader.fetcher);
  let result = toolResult(api, ERROR_CODES, CONFIG.apiBase);
  assert.equal(result.content.length, 2);
  assert.match(result.content[1].text, /expires on 2026-10-01/);
  assert.match(result.content[1].text, /Create a new one/);

  const without = stubFetch(jsonResponse(200, { projects: [] }));
  api = await callOperation(CONFIG, operationFor("listProjects"), {}, without.fetcher);
  result = toolResult(api, ERROR_CODES, CONFIG.apiBase);
  assert.equal(result.content.length, 1);
});

test("an unparseable expiry date is shown as sent rather than as Invalid Date", () => {
  assert.match(expiryLine("whenever"), /expires on whenever/);
});
