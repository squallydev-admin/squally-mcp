// Diagnostics: why a request never arrived, and what environment the server
// was started with. The key and variable values must never appear in either.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { callOperation } from "../dist/api.js";
import { describeFailure, environmentLine, errorCauses } from "../dist/diagnostics.js";
import { loadDocument, operationFor } from "../dist/openapi.js";
import { toolResult } from "../dist/result.js";

const KEY = "sqly_ro_" + "k".repeat(40);
const ERROR_CODES = loadDocument().errorCodes;

/** The shape undici throws: TypeError("fetch failed") with the reason as cause. */
function fetchFailed(cause) {
  return new TypeError("fetch failed", { cause });
}

function systemError(code, message) {
  return Object.assign(new Error(message), { code });
}

// --- error causes ----------------------------------------------------------

test("the cause's code and message are read out of 'fetch failed'", () => {
  const error = fetchFailed(systemError("ENOTFOUND", "getaddrinfo ENOTFOUND app.squally.dev"));
  assert.deepEqual(errorCauses(error), [
    { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND app.squally.dev" },
  ]);
});

test("nested causes follow, outermost first", () => {
  const tls = systemError("UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "unable to get local issuer certificate");
  const connect = Object.assign(new Error("Connect failed", { cause: tls }), { code: "UND_ERR_SOCKET" });
  assert.deepEqual(errorCauses(fetchFailed(connect)), [
    { code: "UND_ERR_SOCKET", message: "Connect failed" },
    { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", message: "unable to get local issuer certificate" },
  ]);
});

test("an AggregateError lists each address it tried", () => {
  // A connect over IPv4 and IPv6 that fails on both: empty message, one error
  // per address.
  const aggregate = Object.assign(
    new AggregateError([
      systemError("ETIMEDOUT", "connect ETIMEDOUT 76.76.21.21:443"),
      systemError("ENETUNREACH", "connect ENETUNREACH 2606:4700::1:443"),
    ]),
    { code: "ETIMEDOUT" },
  );
  assert.deepEqual(errorCauses(fetchFailed(aggregate)), [
    { code: "ETIMEDOUT", message: "AggregateError" },
    { code: "ETIMEDOUT", message: "connect ETIMEDOUT 76.76.21.21:443" },
    { code: "ENETUNREACH", message: "connect ENETUNREACH 2606:4700::1:443" },
  ]);
});

test("no cause, a cycle, or a runaway chain stays finite", () => {
  assert.deepEqual(errorCauses(new TypeError("fetch failed")), []);
  assert.deepEqual(errorCauses("not an error"), []);

  const loop = new Error("loop");
  loop.cause = loop;
  assert.equal(errorCauses(fetchFailed(loop)).length, 1);

  let deep = new Error("bottom");
  for (let i = 0; i < 50; i++) deep = new Error(`level ${i}`, { cause: deep });
  assert.equal(errorCauses(fetchFailed(deep)).length, 8);
});

test("a cause without a code reads as its message", () => {
  assert.equal(
    describeFailure("fetch failed", errorCauses(fetchFailed(new Error("bad port")))),
    "fetch failed; cause: bad port",
  );
});

test("the tool error carries the causes, and never the key", async () => {
  // The worst case: a stack that echoes the Authorization header.
  const leaky = systemError("ECONNRESET", `socket hang up (Authorization: Bearer ${KEY})`);
  const fetcher = async () => {
    throw fetchFailed(leaky);
  };
  const config = { apiBase: "https://app.squally.dev/api/v1", apiKey: KEY, userAgent: "squally-mcp/test" };
  const api = await callOperation(config, operationFor("listProjects"), {}, fetcher);
  const text = toolResult(api, ERROR_CODES, config.apiBase).content[0].text;

  assert.match(text, /Could not reach the Squally API at https:\/\/app\.squally\.dev\/api\/v1/);
  assert.match(text, /fetch failed; cause \[ECONNRESET\]: socket hang up/);
  assert.equal(text.includes(KEY), false, "the key reached the tool error");
  assert.match(text, /\[redacted\]/);
});

test("a real refused connection names ECONNREFUSED in the tool error", async () => {
  // Through the global fetch, not a stub: a port that was just free and is
  // now closed. No network beyond this machine.
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  const config = { apiBase: `http://127.0.0.1:${port}/api/v1`, apiKey: KEY, userAgent: "squally-mcp/test" };
  const api = await callOperation(config, operationFor("listProjects"), {});
  assert.equal(api.kind, "unreachable");
  const text = toolResult(api, ERROR_CODES, config.apiBase).content[0].text;
  assert.match(text, /fetch failed; cause \[ECONNREFUSED\]: connect ECONNREFUSED 127\.0\.0\.1:\d+/);
  assert.equal(text.includes(KEY), false);
});

// --- startup environment line ----------------------------------------------

test("the environment line names the set variables, in any case, never a value", () => {
  const line = environmentLine(
    {
      https_proxy: "http://user:hunter2@proxy.corp:8080",
      NO_PROXY: "",
      NODE_OPTIONS: "--secret-flag",
      NODE_EXTRA_CA_CERTS: "C:\\certs\\corp.pem",
      PATH: "C:\\Windows",
      SQUALLY_API_KEY: KEY,
    },
    "v22.14.0",
    "C:\\Program Files\\nodejs\\node.exe",
  );
  assert.equal(
    line,
    "squally-mcp environment: node v22.14.0 at C:\\Program Files\\nodejs\\node.exe; " +
      "network variables set: https_proxy, NO_PROXY (empty), NODE_EXTRA_CA_CERTS, NODE_OPTIONS",
  );
  for (const secret of ["hunter2", "proxy.corp", "--secret-flag", "corp.pem", KEY]) {
    assert.equal(line.includes(secret), false, `the line carries ${secret}`);
  }
});

test("with none of them set, the line says none", () => {
  assert.match(environmentLine({ PATH: "/usr/bin" }, "v24.1.0", "/usr/bin/node"), /network variables set: none$/);
});

test("the server logs the environment once at startup, before ready", async () => {
  const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const { SQUALLY_API_URL: _url, ...base } = process.env;
  const child = spawn(process.execPath, [entry], {
    env: { ...base, SQUALLY_API_KEY: KEY, HTTPS_PROXY: "http://user:hunter2@proxy.corp:8080" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "ready" within 10s; stderr: ${stderr}`)), 10_000);
      child.stderr.on("data", () => {
        if (/ready - /.test(stderr)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", (code) => reject(new Error(`exited ${code}; stderr: ${stderr}`)));
    });
  } finally {
    child.kill();
  }

  const lines = stderr.trim().split(/\r?\n/);
  const environment = lines.filter((l) => l.startsWith("squally-mcp environment:"));
  assert.equal(environment.length, 1, stderr);
  assert.ok(lines.indexOf(environment[0]) < lines.findIndex((l) => /ready - /.test(l)), "logged before ready");
  assert.ok(environment[0].includes(`node ${process.version} at ${process.execPath}`));
  assert.match(environment[0], /network variables set: .*HTTPS_PROXY/);
  assert.equal(stderr.includes("hunter2"), false, "a proxy credential reached stderr");
  assert.equal(stderr.includes(KEY), false, "the key reached stderr");
});
