// The subpath exports: what other packages may import, and what importing them
// does - which must be nothing.
//
// "." IS THE CLI, as it always was: importing it starts the server (or exits 1
// without a key). ./tools and ./instructions are data for others - the docs
// build reads its tool table from ./tools - so importing them must not start
// anything. Checked in a child process, through the package's own name, so the
// exports map is resolved exactly as it is for a consumer (Node's
// self-reference), and a server that did start could not hide in this one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toolList } from "../dist/server.js";
import { TOOLS } from "../dist/tools.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const READ_KEY = "sqly_ro_" + "a".repeat(40);

// The environment of the parent, minus anything that configures the server.
const { SQUALLY_API_KEY: _key, SQUALLY_API_URL: _url, ...BASE_ENV } = process.env;

/** Imports `specifier` in a fresh node, stdin closed; reports what happened. */
function importInChild(specifier, extraEnv = {}) {
  // A JSON module is only importable with its attribute.
  const attributes = specifier.endsWith(".json") ? `, { with: { type: "json" } }` : "";
  const script =
    `const m = await import(${JSON.stringify(specifier)}${attributes});` +
    `process.stdout.write(JSON.stringify(Object.keys(m).sort()));`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { ...BASE_ENV, ...extraEnv },
    input: "",
    encoding: "utf8",
    timeout: 15_000,
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr, error: child.error };
}

test("the check sees a side effect: importing '.' is the CLI, as before", () => {
  // The control. Without it, a child that prints nothing could mean "no side
  // effect" or "this harness cannot see one".
  const noKey = importInChild("squally-mcp");
  assert.equal(noKey.status, 1);
  assert.match(noKey.stderr, /squally-mcp: SQUALLY_API_KEY is not set/);

  const withKey = importInChild("squally-mcp", { SQUALLY_API_KEY: READ_KEY });
  assert.match(withKey.stderr, /squally-mcp \d+\.\d+\.\d+ ready/);
});

for (const [specifier, expectedExports] of [
  ["squally-mcp/tools", ["ANNOTATIONS", "TOOLS"]],
  ["squally-mcp/instructions", ["INSTRUCTIONS"]],
  ["squally-mcp/package.json", ["default"]],
]) {
  test(`importing ${specifier} has no side effects`, () => {
    // Both environments: without a key the CLI would exit 1 with its message,
    // with one it would announce "ready" on stderr.
    for (const env of [{}, { SQUALLY_API_KEY: READ_KEY }]) {
      const result = importInChild(specifier, env);
      assert.equal(result.error, undefined, `${specifier}: ${result.error}`);
      assert.equal(result.status, 0, `${specifier} exited ${result.status}: ${result.stderr}`);
      assert.equal(result.stderr, "", `${specifier} wrote to stderr`);
      assert.deepEqual(JSON.parse(result.stdout), expectedExports);
    }
  });
}

test("every tool says what it answers and what it costs, for people", () => {
  for (const tool of TOOLS) {
    assert.equal(typeof tool.answers, "string", tool.name);
    assert.ok(tool.answers.length > 0, `${tool.name}: empty answers`);
    assert.ok(["cheap", "expensive"].includes(tool.cost), `${tool.name}: cost ${tool.cost}`);
  }
  // §5.1 had exactly one tool that cost an engine pass, squally-list-flaky-tests.
  // Since 0.2.0 there is none: the engine is gone, and squally-list-tests is
  // paged in the database ("expensive" stays in the type for the docs).
  assert.deepEqual(
    TOOLS.filter((t) => t.cost === "expensive").map((t) => t.name),
    [],
  );
});

test("answers and cost never reach the wire", () => {
  for (const tool of toolList()) {
    assert.deepEqual(
      Object.keys(tool),
      ["name", "title", "description", "inputSchema", "outputSchema", "annotations"],
      `${tool.name} carries fields meant for people`,
    );
  }
});

test("the README's tool table says what TOOLS says", () => {
  // Two copies of one text - the README for npm and GitHub, TOOLS for the docs.
  // Held together here rather than trusted to stay in step.
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const rows = new Map(
    [...readme.matchAll(/^\| `(squally-[a-z-]+)` \| (.+?) \| (.+?) \|$/gm)].map((m) => [
      m[1],
      { answers: m[2], cost: m[3] },
    ]),
  );
  const plain = (cell) => cell.replace(/\*\*|`/g, "");
  assert.deepEqual([...rows.keys()], TOOLS.map((t) => t.name), "README table rows");
  for (const tool of TOOLS) {
    const row = rows.get(tool.name);
    assert.equal(plain(row.answers), tool.answers, `${tool.name}: README "What it answers"`);
    assert.ok(plain(row.cost).startsWith(tool.cost), `${tool.name}: README cost "${row.cost}"`);
  }
});
