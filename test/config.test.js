// Configuration: what is required, what is refused, and how the base URL is
// normalised. Nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { normaliseBaseUrl, resolveConfig, DEFAULT_BASE_URL } from "../dist/config.js";

const READ_KEY = "sqly_ro_" + "a".repeat(40);
const INGEST_KEY = "sqly_" + "b".repeat(43);

test("a read key and no base URL gives the default host", () => {
  const result = resolveConfig({ SQUALLY_API_KEY: READ_KEY }, "9.9.9");
  assert.equal(result.ok, true);
  assert.equal(result.config.apiBase, "https://app.squally.dev/api/v1");
  assert.equal(result.config.apiKey, READ_KEY);
  assert.equal(result.config.userAgent, "squally-mcp/9.9.9");
});

test("a missing key is one clear line naming the variable and where to get one", () => {
  for (const env of [{}, { SQUALLY_API_KEY: "" }, { SQUALLY_API_KEY: "   " }]) {
    const result = resolveConfig(env, "1.0.0");
    assert.equal(result.ok, false, JSON.stringify(env));
    assert.match(result.message, /SQUALLY_API_KEY is not set/);
    assert.match(result.message, /Settings -> API keys/);
  }
});

test("an ingest key is refused by name, not by a 401 from the server", () => {
  const result = resolveConfig({ SQUALLY_API_KEY: INGEST_KEY }, "1.0.0");
  assert.equal(result.ok, false);
  assert.match(result.message, /project ingest key/);
  assert.match(result.message, /organization read key/);
  assert.match(result.message, /Settings -> API keys/);
});

test("no refusal message ever contains the key itself", () => {
  // The rule, asserted rather than trusted: these strings reach a client's log.
  for (const key of [INGEST_KEY, "sqly_short"]) {
    const result = resolveConfig({ SQUALLY_API_KEY: key }, "1.0.0");
    if (result.ok) continue;
    assert.equal(
      result.message.includes(key),
      false,
      "the message printed the key",
    );
  }
});

test("a key matching neither prefix is passed through to the server", () => {
  // Deliberate: the server is the authority on what a valid key is, and it
  // answers invalid_key with its own sentence. A second copy of that rule in a
  // client we do not control the release of would be the thing that goes stale.
  const result = resolveConfig({ SQUALLY_API_KEY: "something-else" }, "1.0.0");
  assert.equal(result.ok, true);
});

test("base URL normalisation accepts the three spellings people write", () => {
  const expected = "https://app.squally.dev/api/v1";
  for (const input of [
    "https://app.squally.dev",
    "https://app.squally.dev/",
    "https://app.squally.dev///",
    "https://app.squally.dev/api/v1",
    "https://app.squally.dev/api/v1/",
    "  https://app.squally.dev/api/v1  ",
  ]) {
    assert.equal(normaliseBaseUrl(input), expected, input);
  }
});

test("a local base URL keeps its port and gains exactly one /api/v1", () => {
  assert.equal(normaliseBaseUrl("http://localhost:3000"), "http://localhost:3000/api/v1");
  assert.equal(normaliseBaseUrl("http://localhost:3000/"), "http://localhost:3000/api/v1");
  assert.equal(
    normaliseBaseUrl("http://localhost:3000/api/v1"),
    "http://localhost:3000/api/v1",
    "copying the servers entry out of the OpenAPI document must not double the prefix",
  );
});

test("SQUALLY_API_URL is used when set, and the default otherwise", () => {
  const custom = resolveConfig(
    { SQUALLY_API_KEY: READ_KEY, SQUALLY_API_URL: "http://localhost:3000" },
    "1.0.0",
  );
  assert.equal(custom.config.apiBase, "http://localhost:3000/api/v1");

  const blank = resolveConfig({ SQUALLY_API_KEY: READ_KEY, SQUALLY_API_URL: "  " }, "1.0.0");
  assert.equal(blank.config.apiBase, normaliseBaseUrl(DEFAULT_BASE_URL));
});
