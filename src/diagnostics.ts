// Diagnostics for the failure a user cannot see from inside a client: a
// request that never reached the API.
//
// WHY (25.09.): a Claude Desktop session on Windows (Microsoft Store build)
// answered every tool call with "fetch failed", while plain node in a terminal
// on the same machine reached the same URL. "fetch failed" is undici's wrapper
// for everything from DNS to TLS; the reason is in error.cause - and, when a
// connect tried several addresses, in an AggregateError's `errors`. Without
// them the log says nothing about which of those it was.
//
// NEVER A SECRET. The startup line names variables and never prints a value:
// a proxy URL can carry credentials, and NODE_OPTIONS can carry anything. The
// causes carry only what the network stack wrote; api.ts still scrubs the key
// out of them, in case a stack ever echoes a header.

/** One link of an error's cause chain. */
export type ErrorCause = {
  /** The system or library code (ENOTFOUND, UND_ERR_CONNECT_TIMEOUT, ...), if any. */
  code: string | null;
  message: string;
};

/** Enough for any real chain (fetch -> connect -> AggregateError -> 2 addresses). */
const MAX_CAUSES = 8;

/**
 * The causes below an error, outermost first: each `cause`, and for an
 * AggregateError each of its `errors` before its own cause. The error itself
 * is not included - its message is the one the caller already has. Cycles and
 * runaway chains stop at MAX_CAUSES.
 */
export function errorCauses(error: unknown): ErrorCause[] {
  const causes: ErrorCause[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown): void => {
    if (value === undefined || value === null || causes.length >= MAX_CAUSES || seen.has(value)) return;
    seen.add(value);
    if (typeof value !== "object") {
      causes.push({ code: null, message: String(value) });
      return;
    }
    const link = value as { code?: unknown; message?: unknown; name?: unknown; errors?: unknown; cause?: unknown };
    const code = typeof link.code === "string" || typeof link.code === "number" ? String(link.code) : null;
    // An AggregateError from a failed multi-address connect has an empty
    // message; its name is the next best thing.
    const message =
      typeof link.message === "string" && link.message !== "" ? link.message : String(link.name ?? "Error");
    causes.push({ code, message });
    if (Array.isArray(link.errors)) for (const inner of link.errors) visit(inner);
    visit(link.cause);
  };

  if (typeof error === "object" && error !== null) visit((error as { cause?: unknown }).cause);
  return causes;
}

/** "fetch failed; cause [ENOTFOUND]: getaddrinfo ENOTFOUND app.squally.dev" */
export function describeFailure(detail: string, causes: ErrorCause[]): string {
  return [detail, ...causes.map((c) => (c.code ? `cause [${c.code}]: ${c.message}` : `cause: ${c.message}`))].join(
    "; ",
  );
}

/**
 * The variables that change how Node reaches the network, matched in any
 * case (Windows keeps whatever case they were set in; undici-style tools read
 * both spellings of the proxy ones).
 */
export const NETWORK_VARIABLES = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
] as const;

/**
 * One line for stderr at startup: the Node that runs this server, and which of
 * NETWORK_VARIABLES are set - by NAME ONLY, an empty one marked as such.
 */
export function environmentLine(env: NodeJS.ProcessEnv, nodeVersion: string, execPath: string): string {
  const rank = (name: string) => NETWORK_VARIABLES.indexOf(name.toUpperCase() as (typeof NETWORK_VARIABLES)[number]);
  const set = Object.keys(env)
    .filter((name) => rank(name) >= 0 && env[name] !== undefined)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => (env[name] === "" ? `${name} (empty)` : name));
  return (
    `squally-mcp environment: node ${nodeVersion} at ${execPath}; ` +
    `network variables set: ${set.length > 0 ? set.join(", ") : "none"}`
  );
}
