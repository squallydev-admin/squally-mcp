// Where the key and the base URL come from, and what is refused before a
// single request is made.
//
// NOTHING HERE EVER PRINTS A KEY. Every message names the variable, never its
// value - the same rule squally-reporter adopted after a key reached a results
// file in plain text. A server whose first line of output leaks a credential
// into a client's log has failed before it started.

/** The host the server talks to unless SQUALLY_API_URL says otherwise. */
export const DEFAULT_BASE_URL = "https://app.squally.dev";

/** Every route this server calls lives under this prefix. */
export const API_PREFIX = "/api/v1";

/**
 * An organization READ key. The `_ro_` infix is a promise (read-api-mcp-spec
 * §11 Q2): a key with this prefix can never gain a write scope.
 */
export const READ_KEY_PREFIX = "sqly_ro_";

/**
 * A project INGEST key - what the Playwright reporter uses. It is one
 * character-class away from a read key, which is exactly why it is worth
 * catching here (spec §2.4): sent to a read route it would earn a 401 that
 * says "invalid key", and the user would go looking for a typo instead of
 * reading the prefix.
 */
export const INGEST_KEY_PREFIX = "sqly_";

export type Config = {
  /** Fully-qualified, ending in /api/v1 and never in a slash. */
  apiBase: string;
  apiKey: string;
  userAgent: string;
};

/**
 * Turns whatever the user put in SQUALLY_API_URL into a base this server can
 * append paths to.
 *
 * Accepts the three spellings people actually write - `https://host`,
 * `https://host/`, `https://host/api/v1` - and produces one. Tolerating the
 * third matters: the OpenAPI document's `servers` entry IS
 * `https://app.squally.dev/api/v1`, so copying it out of the docs is the
 * obvious mistake, and the result would otherwise be a silent
 * `/api/v1/api/v1/...` that 404s while naming the right host.
 */
export function normaliseBaseUrl(raw: string): string {
  let base = raw.trim();
  while (base.endsWith("/")) base = base.slice(0, -1);
  if (base.endsWith(API_PREFIX)) base = base.slice(0, -API_PREFIX.length);
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base + API_PREFIX;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; message: string };

/**
 * Resolves the configuration, or says in one sentence what to fix.
 *
 * Returns rather than throws, so index.ts owns the exit: a stack trace in a
 * client's MCP log is noise, and the one line below is the whole diagnosis.
 */
export function resolveConfig(env: NodeJS.ProcessEnv, version: string): ConfigResult {
  const apiKey = env.SQUALLY_API_KEY?.trim();

  if (!apiKey) {
    return {
      ok: false,
      message:
        "SQUALLY_API_KEY is not set. Create an organization read key in Squally under " +
        "Settings -> API keys and set it in this server's environment.",
    };
  }

  // The order matters: an ingest key DOES start with sqly_, so the read-key
  // test has to come first or every read key would be reported as an ingest
  // key.
  if (!apiKey.startsWith(READ_KEY_PREFIX) && apiKey.startsWith(INGEST_KEY_PREFIX)) {
    return {
      ok: false,
      message:
        "SQUALLY_API_KEY looks like a project ingest key; the MCP server needs an " +
        "organization read key (Settings -> API keys). A read key starts with " +
        `${READ_KEY_PREFIX} and is created separately from the ingest key your ` +
        "Playwright reporter uses.",
    };
  }

  // A key matching neither prefix is passed through on purpose: the server is
  // the authority on what a valid key is, and it answers invalid_key with a
  // sentence of its own. Guessing here would mean maintaining a second copy of
  // that rule in a client we do not control the release of.
  const rawBase = env.SQUALLY_API_URL?.trim();
  return {
    ok: true,
    config: {
      apiBase: rawBase ? normaliseBaseUrl(rawBase) : normaliseBaseUrl(DEFAULT_BASE_URL),
      apiKey,
      userAgent: `squally-mcp/${version}`,
    },
  };
}
