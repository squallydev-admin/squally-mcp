// One scenario of test/system-ca.test.js, in a process of its own: trusting
// certificates changes Node's defaults for the whole process, so scenarios
// must not share one.
//
//   node probe.mjs call <apiBase> <system>   one squally-list-projects call
//   node probe.mjs inventory                 what trusting did to the list
//
// <system> is what the operating system's store is made to hold: "fixture"
// (ca.pem), "empty", or "real" (the actual store, untouched). The store itself
// cannot be changed from a test, so only getCACertificates("system") is stood
// in for - the default list, setDefaultCACertificates, TLS, fetch and the tool
// result are all the real ones.
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

import { callOperation } from "../../../dist/api.js";
import { loadDocument, operationFor } from "../../../dist/openapi.js";
import { toolResult } from "../../../dist/result.js";
import { trustSystemCertificates } from "../../../dist/system-ca.js";

const FIXTURE_CA = readFileSync(new URL("./ca.pem", import.meta.url), "utf8");

function caApi(system) {
  if (system === "real") return tls;
  return {
    getCACertificates: (type) =>
      type === "system" ? (system === "fixture" ? [FIXTURE_CA] : []) : tls.getCACertificates(type),
    setDefaultCACertificates: (certs) => tls.setDefaultCACertificates(certs),
  };
}

const [mode, ...rest] = process.argv.slice(2);

if (mode === "call") {
  const [apiBase, system] = rest;
  const outcome = trustSystemCertificates(process.env, caApi(system));
  const config = { apiBase, apiKey: "sqly_ro_" + "t".repeat(40), userAgent: "squally-mcp/probe" };
  const result = await callOperation(config, operationFor("listProjects"), {});
  const text = toolResult(result, loadDocument().errorCodes, apiBase).content[0].text;
  process.stdout.write(JSON.stringify({ outcome, kind: result.kind, text }));
} else if (mode === "inventory") {
  const fp = (pem) => new X509Certificate(pem).fingerprint256;
  const before = tls.getCACertificates("default").map(fp);
  const bundled = tls.getCACertificates("bundled").map(fp);
  const outcome = trustSystemCertificates(process.env, caApi("fixture"));
  const after = new Set(tls.getCACertificates("default").map(fp));
  process.stdout.write(
    JSON.stringify({
      outcome,
      before: before.length,
      after: after.size,
      keptPrevious: before.every((f) => after.has(f)),
      keptBundled: bundled.every((f) => after.has(f)),
      hasFixture: after.has(fp(FIXTURE_CA)),
    }),
  );
} else {
  throw new Error(`unknown mode ${mode}`);
}
