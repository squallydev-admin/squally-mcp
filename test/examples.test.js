// Every tool end to end, through a real MCP client, against the answers the
// OpenAPI document itself gives as examples (test/fixtures/examples.js).
//
// WHY A REAL CLIENT: the SDK's Client validates a tool result's
// structuredContent against the tool's outputSchema before it hands the
// result over, and throws when it does not fit - which is what every client
// with output validation will do to this server. So a pass here says more
// than "the example parsed": the documented answer of each operation fits the
// schema this server publishes for it, as a client checks it. The control at
// the end proves the check runs at all.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../dist/server.js";
import { TOOLS } from "../dist/tools.js";
import { errorExample, successExample } from "./fixtures/examples.js";

const CONFIG = {
  apiBase: "https://app.squally.dev/api/v1",
  apiKey: "sqly_ro_" + "a".repeat(40),
  userAgent: "squally-mcp/0.0.0-test",
};

/** The fewest arguments each tool accepts - the path parameters. */
const MINIMAL_ARGS = {
  "squally-list-projects": {},
  "squally-find-run": { projectId: "p1" },
  "squally-get-run": { projectId: "p1", runId: "r1" },
  "squally-debug-failure": { projectId: "p1", runId: "r1", testName: "t" },
  "squally-get-test-metrics": { projectId: "p1", testName: "t" },
  "squally-list-tests": { projectId: "p1" },
  "squally-list-errors": { projectId: "p1" },
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A server whose every request is answered by `answer`, and a client on it. */
async function connect(answer) {
  const requests = [];
  const fetcher = async (url) => {
    requests.push(String(url));
    return answer();
  };
  const server = createServer(CONFIG, "0.0.0-test", fetcher);
  const client = new Client({ name: "squally-mcp-examples-test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  // Listing is what makes the client cache each tool's output validator.
  await client.listTools();
  return {
    client,
    requests,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

for (const tool of TOOLS) {
  test(`${tool.name}: the documented 200 answer passes the client's output validation`, async () => {
    const example = successExample(tool.operationId);
    const { client, requests, close } = await connect(() => jsonResponse(200, example));
    try {
      const result = await client.callTool({ name: tool.name, arguments: MINIMAL_ARGS[tool.name] });
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      assert.deepEqual(result.structuredContent, example, "the API's JSON, unchanged");
      assert.equal(requests.length, 1, "one GET per call");
    } finally {
      await close();
    }
  });
}

test("squally-get-test-metrics: runs = 0 with null rates is a valid answer, not an error", async () => {
  // A test with results but no completed CI run in the period - the document
  // describes the case but gives no example of it, so it is derived from the
  // one it gives: zero counts, null rates, nothing recent, no branch to name.
  const quiet = {
    ...successExample("getTestMetrics"),
    days: 7,
    runs: 0,
    stableRuns: 0,
    flakyRuns: 0,
    failedRuns: 0,
    stability: null,
    flakyRate: null,
    failureRate: null,
    timeLostMs: 0,
    recentResults: [],
    branches: [],
    topBranch: null,
  };
  const { client, close } = await connect(() => jsonResponse(200, quiet));
  try {
    const result = await client.callTool({
      name: "squally-get-test-metrics",
      arguments: { projectId: "p1", testName: quiet.testName, days: 7 },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    assert.deepEqual(result.structuredContent, quiet);
  } finally {
    await close();
  }
});

test("squally-get-test-metrics: the documented ambiguous_test lists the files to retry with", async () => {
  const body = errorExample("getTestMetrics", 400, "ambiguous_test");
  const { client, close } = await connect(() => jsonResponse(400, body));
  try {
    const result = await client.callTool({
      name: "squally-get-test-metrics",
      arguments: MINIMAL_ARGS["squally-get-test-metrics"],
    });
    assert.equal(result.isError, true);
    const text = result.content[0].text;
    assert.ok(text.startsWith(body.error), "the API's sentence first, verbatim");
    assert.match(text, /Error code: ambiguous_test/);
    assert.match(text, /Retry with filePath set to exactly one of: "tests\/a\.spec\.ts", "tests\/b\.spec\.ts"/);
    assert.match(text, /What to do: /);
  } finally {
    await close();
  }
});

test("squally-get-test-metrics: the documented test_not_found passes through", async () => {
  const body = errorExample("getTestMetrics", 404, "test_not_found");
  const { client, close } = await connect(() => jsonResponse(404, body));
  try {
    const result = await client.callTool({
      name: "squally-get-test-metrics",
      arguments: MINIMAL_ARGS["squally-get-test-metrics"],
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.startsWith(body.error));
    assert.match(result.content[0].text, /Error code: test_not_found/);
  } finally {
    await close();
  }
});

test("control: an answer that breaks the output schema is rejected by the client", async () => {
  // Without this, every pass above could mean "the client validates nothing".
  const broken = { ...successExample("getTestMetrics"), stability: "0.5" };
  const { client, close } = await connect(() => jsonResponse(200, broken));
  try {
    await assert.rejects(
      client.callTool({
        name: "squally-get-test-metrics",
        arguments: MINIMAL_ARGS["squally-get-test-metrics"],
      }),
      /structured content does not match|output schema/i,
    );
  } finally {
    await close();
  }
});
