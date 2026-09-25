// Trusting the operating system's certificate store (src/system-ca.ts): what
// is added, what is kept, what still fails, and the opt-out.
//
// Each network scenario runs in a child process (test/fixtures/tls/probe.mjs)
// against a local HTTPS server whose certificate is signed by a test CA that no
// real store contains (test/fixtures/tls/README.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:https";
import { X509Certificate } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

import { systemCaDisabled, systemCaLine, trustSystemCertificates } from "../dist/system-ca.js";

const FIXTURES = new URL("./fixtures/tls/", import.meta.url);
const PROBE = fileURLToPath(new URL("probe.mjs", FIXTURES));
const FIXTURE_CA = readFileSync(new URL("ca.pem", FIXTURES), "utf8");
const ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// Everything that could change which roots a child trusts, removed: the
// scenarios set exactly what they test.
const { NODE_EXTRA_CA_CERTS: _e, NODE_OPTIONS: _o, SQUALLY_USE_SYSTEM_CA: _s, SQUALLY_API_URL: _u, ...BASE_ENV } =
  process.env;

const RUNTIME_API =
  typeof tls.getCACertificates === "function" && typeof tls.setDefaultCACertificates === "function";
const NEEDS_API = RUNTIME_API
  ? false
  : `Node ${process.version} has no tls.setDefaultCACertificates (22.19+ / 24.5+)`;

/** A local HTTPS server answering GET /api/v1/projects, like the API would. */
async function withServer(fn) {
  const server = createServer(
    {
      cert: readFileSync(new URL("server.pem", FIXTURES)),
      key: readFileSync(new URL("server-key.pem", FIXTURES)),
    },
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ projects: [] }));
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`https://127.0.0.1:${server.address().port}/api/v1`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * The issuer a client on THIS machine is actually shown by the fixture server,
 * when it is not the fixture CA - i.e. when something re-signs even local TLS.
 *
 * MEASURED 25.09.: Norton Web/Mail Shield intercepts loopback connections too,
 * and re-signs a certificate it cannot validate with its "Untrusted Root" - by
 * design never trusted, so no fixture server can be reached through it. Found
 * here, the scenarios that need a clean TLS path skip and name the program;
 * they run in full wherever TLS is not intercepted, CI included.
 *
 * Inspection only: this connection's certificate is read and the connection
 * closed. rejectUnauthorized: false is needed to SEE an untrusted certificate
 * and appears nowhere outside this test (see the last test in this file).
 */
async function interceptingIssuer() {
  const fixtureCa = new X509Certificate(FIXTURE_CA).subject;
  return withServer(
    (apiBase) =>
      new Promise((resolve) => {
        const { port } = new URL(apiBase);
        const socket = tls.connect(
          { host: "127.0.0.1", port: Number(port), servername: "localhost", rejectUnauthorized: false },
          () => {
            const issuer = socket.getPeerCertificate().issuer;
            socket.end();
            // X509Certificate#subject joins its parts with a newline.
            const shown = Object.entries(issuer ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
            resolve(shown === fixtureCa ? null : issuer?.CN ?? "an unknown issuer");
          },
        );
        socket.on("error", () => resolve(null));
      }),
  );
}

const INTERCEPTED_BY = await interceptingIssuer();
const NEEDS_CLEAN_TLS =
  NEEDS_API ||
  (INTERCEPTED_BY
    ? `NOT CHECKED here - local TLS is re-signed by "${INTERCEPTED_BY}" on this machine; runs in full where TLS is not intercepted (CI)`
    : false);

/**
 * NEVER SKIPPED IN CI. CI is where these scenarios are known to run - a skip
 * there would let a green build stand for a check that never happened, the
 * release workflow's included. So in CI (GitHub sets CI=true) a reason to skip
 * becomes a failure that states it.
 */
const IN_CI = Boolean(process.env.CI);
function skipOutsideCi(reason) {
  return IN_CI ? false : reason;
}
function mustRun(reason) {
  assert.equal(reason, false, `in CI this scenario must run, but: ${reason}`);
}

/** Runs the probe in its own process - asynchronously, so the server above can answer. */
function probe(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PROBE, ...args], { env: { ...BASE_ENV, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`probe exited ${code}: ${stderr}`));
      else resolve(JSON.parse(stdout));
    });
  });
}

// --- the three scenarios ---------------------------------------------------

test("a server whose CA only the system store knows is reached", { skip: skipOutsideCi(NEEDS_CLEAN_TLS) }, async () => {
  mustRun(NEEDS_CLEAN_TLS);
  const result = await withServer((apiBase) => probe(["call", apiBase, "fixture"]));
  assert.deepEqual(result.outcome, { kind: "loaded", added: 1, unparseable: 0 });
  assert.equal(result.kind, "success", result.text);
});

test("a certificate nobody trusts still fails, with its cause", async () => {
  // The REAL system store, not a stand-in: adding it must not make an unknown
  // CA acceptable. Verification is on; only the list of roots grew.
  const result = await withServer((apiBase) => probe(["call", apiBase, "real"]));
  assert.equal(result.kind, "unreachable");
  assert.match(result.text, /fetch failed; cause \[UNABLE_TO_VERIFY_LEAF_SIGNATURE\]/);
});

test("SQUALLY_USE_SYSTEM_CA=0 restores the old behaviour", async () => {
  // The same server the first scenario reaches - refused, because the system
  // store is not consulted.
  const result = await withServer((apiBase) =>
    probe(["call", apiBase, "fixture"], { SQUALLY_USE_SYSTEM_CA: "0" }),
  );
  assert.deepEqual(result.outcome, { kind: "disabled" });
  assert.equal(result.kind, "unreachable");
  assert.match(result.text, /cause \[UNABLE_TO_VERIFY_LEAF_SIGNATURE\]/);
});

// --- added, never replaced ---------------------------------------------------

test("Node's own list is kept whole; the system certificate is appended", { skip: skipOutsideCi(NEEDS_API) }, async () => {
  mustRun(NEEDS_API);
  const inventory = await probe(["inventory"]);
  assert.equal(inventory.keptBundled, true, "a bundled Mozilla root was dropped");
  assert.equal(inventory.keptPrevious, true, "a previously trusted root was dropped");
  assert.equal(inventory.hasFixture, true);
  assert.equal(inventory.after, inventory.before + 1);
});

test("NODE_EXTRA_CA_CERTS keeps working, and a root it already holds is not counted again", { skip: skipOutsideCi(NEEDS_CLEAN_TLS) }, async () => {
  mustRun(NEEDS_CLEAN_TLS);
  const extra = { NODE_EXTRA_CA_CERTS: fileURLToPath(new URL("ca.pem", FIXTURES)) };
  const withEmptyStore = await withServer((apiBase) => probe(["call", apiBase, "empty"], extra));
  assert.deepEqual(withEmptyStore.outcome, { kind: "loaded", added: 0, unparseable: 0 });
  assert.equal(withEmptyStore.kind, "success", "the extra CA was replaced");

  const alsoInStore = await withServer((apiBase) => probe(["call", apiBase, "fixture"], extra));
  assert.deepEqual(alsoInStore.outcome, { kind: "loaded", added: 0, unparseable: 0 });
  assert.equal(alsoInStore.kind, "success");
});

// --- the decision and the line, without a network ---------------------------

test("only 0 (or false/no/off) opts out", () => {
  for (const value of ["0", "false", "FALSE", " no ", "off"]) {
    assert.equal(systemCaDisabled({ SQUALLY_USE_SYSTEM_CA: value }), true, value);
  }
  for (const value of [undefined, "", "1", "true", "yes"]) {
    assert.equal(systemCaDisabled({ SQUALLY_USE_SYSTEM_CA: value }), false, String(value));
  }
});

test("an older Node is left alone, and the line says what works there", () => {
  const outcome = trustSystemCertificates({}, {}, "v22.12.0");
  assert.deepEqual(outcome, { kind: "unsupported", nodeVersion: "v22.12.0" });
  const line = systemCaLine(outcome);
  assert.match(line, /could not load the operating system's certificate store/);
  assert.match(line, /v22\.12\.0/);
  assert.match(line, /--use-system-ca/);
});

test("a store that cannot be read changes nothing and says why", () => {
  let replaced = false;
  const outcome = trustSystemCertificates(
    {},
    {
      getCACertificates: (type) => {
        if (type === "system") throw new Error("keychain locked");
        return [];
      },
      setDefaultCACertificates: () => {
        replaced = true;
      },
    },
  );
  assert.deepEqual(outcome, { kind: "failed", reason: "keychain locked" });
  assert.equal(replaced, false);
  assert.match(systemCaLine(outcome), /could not load .*\(keychain locked\)/);
});

test("an unreadable entry is skipped, not fatal", () => {
  let set = null;
  const outcome = trustSystemCertificates(
    {},
    {
      getCACertificates: (type) => (type === "system" ? ["not a certificate", FIXTURE_CA] : []),
      setDefaultCACertificates: (certs) => (set = certs),
    },
  );
  assert.deepEqual(outcome, { kind: "loaded", added: 1, unparseable: 1 });
  assert.deepEqual(set, [FIXTURE_CA]);
  assert.match(systemCaLine(outcome), /1 certificate added, 1 unreadable skipped/);
});

test("the line counts certificates and never names one", () => {
  const line = systemCaLine({ kind: "loaded", added: 41, unparseable: 0 });
  assert.equal(
    line,
    "squally-mcp TLS: trusting the operating system's certificate store in addition to Node's (41 certificates added)",
  );
  assert.match(systemCaLine({ kind: "disabled" }), /disabled by SQUALLY_USE_SYSTEM_CA/);
});

// --- startup and the rule that verification stays on --------------------------

/** Starts the real server, returns its stderr once it said "ready". */
async function startupStderr(env) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...BASE_ENV, SQUALLY_API_KEY: "sqly_ro_" + "s".repeat(40), ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "ready" in 10s: ${stderr}`)), 10_000);
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (/ready - /.test(stderr)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", (code) => reject(new Error(`exited ${code}: ${stderr}`)));
    });
  } finally {
    child.kill();
  }
  return stderr.split(/\r?\n/).filter((l) => l.startsWith("squally-mcp TLS:"));
}

test("the server says once at startup whether it trusts the system store", async () => {
  const enabled = await startupStderr({});
  assert.equal(enabled.length, 1, enabled.join("\n"));
  if (RUNTIME_API) assert.match(enabled[0], /trusting the operating system's certificate store .*\(\d+ certificates? added/);

  const disabled = await startupStderr({ SQUALLY_USE_SYSTEM_CA: "0" });
  assert.deepEqual(disabled, [
    "squally-mcp TLS: operating system's certificate store disabled by SQUALLY_USE_SYSTEM_CA - Node's bundled certificates only",
  ]);
});

test("no source file turns certificate verification off", () => {
  const src = new URL("../src/", import.meta.url);
  for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    const code = readFileSync(new URL(file, src), "utf8");
    assert.doesNotMatch(code, /rejectUnauthorized\s*:\s*false/, file);
    assert.doesNotMatch(code, /NODE_TLS_REJECT_UNAUTHORIZED/, file);
  }
});
