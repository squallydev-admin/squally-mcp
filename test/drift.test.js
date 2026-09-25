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

import {
  inputSchemaFor,
  loadDocument,
  OMITTED_PARAMETERS,
  omittedParameters,
  outputSchemaFor,
  parseDocument,
} from "../dist/openapi.js";
import { TOOLS } from "../dist/tools.js";

const LIVE_URL = "https://app.squally.dev/openapi/v1.json";
const TIMEOUT_MS = 10_000;

/**
 * SemVer precedence of two API versions ("1.0.0-beta.2"): negative when `a`
 * is older. Null when either is not a version this can order.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
    return m ? { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // A release outranks its prereleases; otherwise identifier by identifier,
  // numbers numerically and below words, and the shorter list first.
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pn && qn) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

/**
 * A skip reason while the live API is OLDER than the vendored document - or
 * null when the comparison should run.
 *
 * ADDED FOR 0.2.0. This package is released together with an API version
 * (1.0.0-beta.2 removed the verdict engine), and between the package's commit
 * and the deploy, the live document is the previous version: every comparison
 * below would report the whole release as drift. That is not drift - the
 * package is ahead of a deploy, not behind the API - and a suite that is red
 * for it teaches everyone to ignore it. So the comparisons wait, LOUDLY, until
 * the live API serves at least the vendored version. A live API that is AHEAD
 * (or the same version, amended) is compared as always: that is the drift this
 * file exists to catch.
 */
function liveIsBehind(live) {
  const vendored = loadDocument().version;
  const order = compareVersions(live.version, vendored);
  if (order === null || order >= 0) return null;
  return (
    `NOT CHECKED - ${LIVE_URL} serves API ${live.version}, older than the vendored ` +
    `${vendored}: this package is ahead of a deploy that has not happened yet. ` +
    "Re-run once the live API serves the vendored version."
  );
}

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
  const behind = liveIsBehind(live.doc);
  if (behind) {
    t.skip(behind);
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

test("the schemas the agent sees are still the ones upstream publishes", async (t) => {
  // STRONGER THAN THE TEST ABOVE, and added 24.09. after a real miss: that one
  // compares operations, paths and parameter NAMES, so when squally-app
  // reworded the `timeLostMs` description - changing what every client is told
  // the field means - nothing here objected. A description is not decoration:
  // it is most of what the model has to go on when it decides which tool to
  // call and how to read the answer.
  //
  // Compared through inputSchemaFor/outputSchemaFor rather than on the raw
  // document, so this asserts the schemas as BUILT - including the parameter
  // descriptions this package overrides on purpose (PARAMETER_DESCRIPTIONS)
  // and the parameters it leaves out (OMITTED_PARAMETERS). Both are applied to
  // both sides equally, so an intentional local deviation cannot trip the
  // check, while an upstream reword of anything else does. Whether the
  // omissions are still harmless is the next test's job.
  const live = await fetchLive();
  if (!live.ok) {
    t.skip(
      `NOT CHECKED - could not reach ${LIVE_URL} (${live.why}). ` +
        "Tool schemas may be out of date; re-run with a network connection.",
    );
    return;
  }
  const behind = liveIsBehind(live.doc);
  if (behind) {
    t.skip(behind);
    return;
  }

  const vendored = loadDocument();
  const problems = [];

  for (const tool of TOOLS) {
    const here = vendored.operations.get(tool.operationId);
    const there = live.doc.operations.get(tool.operationId);
    if (!there) continue; // already reported by the test above

    for (const [what, build] of [
      ["inputSchema", inputSchemaFor],
      ["outputSchema", outputSchemaFor],
    ]) {
      const mine = JSON.stringify(build(here));
      const upstream = JSON.stringify(build(there));
      if (mine === upstream) continue;

      // Name the first field that differs; a whole-schema diff in an assertion
      // message is unreadable and the first one is usually the whole story.
      problems.push(`${tool.name}: ${what} differs from upstream${firstDifference(mine, upstream)}`);
    }
  }

  assert.deepEqual(
    problems,
    [],
    "the schemas clients are given no longer match the published API. Re-vendor with " +
      "`npm run vendor:openapi`, read the diff, and re-pin the digest in test/tools.test.js.",
  );
});

/** A short " (near: ...)" pointing at where two serialised schemas diverge. */
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const from = Math.max(0, i - 40);
  return i >= a.length && i >= b.length ? "" : ` (near: ...${a.slice(from, i + 60)})`;
}

test("the live document's error codes are still the ones the results rely on", async (t) => {
  const live = await fetchLive();
  if (!live.ok) {
    t.skip(`NOT CHECKED - could not reach ${LIVE_URL} (${live.why}).`);
    return;
  }
  const behind = liveIsBehind(live.doc);
  if (behind) {
    t.skip(behind);
    return;
  }

  const missing = [...loadDocument().errorCodes.keys()].filter(
    (code) => !live.doc.errorCodes.has(code),
  );
  assert.deepEqual(missing, [], "error codes disappeared upstream; re-vendor the document");
});

/**
 * DELIBERATE DEVIATION, recorded (0.1.3): squally-find-run offers neither
 * perPage nor direction and squally-list-errors no perPage, although the
 * operations have them (OMITTED_PARAMETERS in src/openapi.ts, per operation
 * since 0.2.0 - squally-list-tests keeps its perPage). Harmless only while
 * each stays OPTIONAL - a required one could never be sent - and while the
 * API's defaults are the ones the tools are documented to get: 10 rows per
 * page, paging towards older runs.
 */
const OMITTED_DEFAULTS = { perPage: 10, direction: "next" };

function omissionProblems(doc) {
  const problems = [];
  for (const tool of TOOLS) {
    const operation = doc.operations.get(tool.operationId);
    if (!operation) continue; // reported by the first test
    const omitted = omittedParameters(operation);
    for (const parameter of operation.parameters.filter((p) => omitted.has(p.name))) {
      if (parameter.required) problems.push(`${tool.name}: ${parameter.name} became required`);
      const expected = OMITTED_DEFAULTS[parameter.name];
      if (parameter.schema.default !== expected) {
        problems.push(
          `${tool.name}: ${parameter.name} default is ${JSON.stringify(parameter.schema.default)}, ` +
            `the tools promise ${JSON.stringify(expected)}`,
        );
      }
    }
  }
  return problems;
}

test("the parameters the tools leave out are exactly these, per operation", () => {
  // Leaving out another one is the same kind of decision; this makes it a
  // visible one.
  assert.deepEqual(
    Object.fromEntries([...OMITTED_PARAMETERS].map(([id, names]) => [id, [...names].sort()])),
    { listRuns: ["direction", "perPage"], listErrors: ["perPage"] },
  );
});

test("API versions order the way the release gate above needs", () => {
  // The gate skips the live comparisons only while live < vendored; getting
  // this order wrong would either hide real drift or fail every release.
  assert.ok(compareVersions("1.0.0-beta", "1.0.0-beta.2") < 0);
  assert.ok(compareVersions("1.0.0-beta.2", "1.0.0-beta.10") < 0);
  assert.ok(compareVersions("1.0.0-beta.2", "1.0.0") < 0);
  assert.ok(compareVersions("1.0.0-alpha.9", "1.0.0-beta") < 0);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.2"), 0);
  assert.ok(compareVersions("1.1.0", "1.0.9") > 0);
  assert.equal(compareVersions("unknown", "1.0.0"), null);
});

test("the left-out parameters are optional, with a page size of 10 - vendored document", () => {
  assert.deepEqual(omissionProblems(loadDocument()), []);
});

test("the left-out parameters are optional, with a page size of 10 - live document", async (t) => {
  const live = await fetchLive();
  if (!live.ok) {
    t.skip(`NOT CHECKED - could not reach ${LIVE_URL} (${live.why}).`);
    return;
  }
  assert.deepEqual(
    omissionProblems(live.doc),
    [],
    "upstream changed a parameter the tools leave out. Either offer it again or fix the " +
      "documented default in src/openapi.ts, the README and this test.",
  );
});
