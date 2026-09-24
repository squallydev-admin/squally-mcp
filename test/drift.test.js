// Has the live API moved away from the document this package vendored?
//
// Vendoring without this check is a stale copy with extra steps. The tools
// derive their schemas from src/openapi/v1.json, so if an operation or a
// parameter disappears upstream, every client keeps being told it exists and
// the failure only shows up as a 404 or an invalid_parameter in someone's
// agent session.
//
// SKIPPED OFFLINE, LOUDLY. A green suite on a laptop with no network must not
// read as "the document is current" - node:test prints the skip reason, and
// that reason says what was not checked.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDocument, loadDocument } from "../dist/openapi.js";
import { TOOLS } from "../dist/tools.js";

const LIVE_URL = "https://app.squally.dev/openapi/v1.json";
const TIMEOUT_MS = 10_000;

async function fetchLive() {
  try {
    const response = await fetch(LIVE_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, why: `${LIVE_URL} answered ${response.status}` };
    return { ok: true, doc: parseDocument(await response.text()) };
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}

test("the vendored OpenAPI document still matches the live one", async (t) => {
  const live = await fetchLive();
  if (!live.ok) {
    t.skip(
      `NOT CHECKED - could not reach ${LIVE_URL} (${live.why}). ` +
        "The vendored document may be out of date; re-run with a network connection.",
    );
    return;
  }

  const vendored = loadDocument();
  const problems = [];

  for (const tool of TOOLS) {
    const here = vendored.operations.get(tool.operationId);
    const there = live.doc.operations.get(tool.operationId);

    if (!there) {
      problems.push(`${tool.name}: operation "${tool.operationId}" no longer exists upstream`);
      continue;
    }
    if (here.path !== there.path || here.method !== there.method) {
      problems.push(
        `${tool.name}: route moved - vendored ${here.method} ${here.path}, ` +
          `live ${there.method} ${there.path}`,
      );
    }

    const liveParams = new Map(there.parameters.map((p) => [p.name, p]));
    for (const parameter of here.parameters) {
      const upstream = liveParams.get(parameter.name);
      if (!upstream) {
        problems.push(`${tool.name}: parameter "${parameter.name}" no longer exists upstream`);
        continue;
      }
      if (Boolean(upstream.required) !== Boolean(parameter.required)) {
        problems.push(
          `${tool.name}: parameter "${parameter.name}" changed required ` +
            `${Boolean(parameter.required)} -> ${Boolean(upstream.required)}`,
        );
      }
    }
  }

  assert.deepEqual(
    problems,
    [],
    "the live API has moved. Re-vendor with `npm run vendor:openapi`, review the diff, " +
      "and re-pin the digest in test/tools.test.js.",
  );
});

test("the live document's error codes are still the ones the results rely on", async (t) => {
  const live = await fetchLive();
  if (!live.ok) {
    t.skip(`NOT CHECKED - could not reach ${LIVE_URL} (${live.why}).`);
    return;
  }

  const missing = [...loadDocument().errorCodes.keys()].filter(
    (code) => !live.doc.errorCodes.has(code),
  );
  assert.deepEqual(missing, [], "error codes disappeared upstream; re-vendor the document");
});
