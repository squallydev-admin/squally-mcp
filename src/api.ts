// One HTTP GET per tool call, and the translation of whatever comes back.
//
// A THIN CLIENT (read-api-mcp-spec §6.1): "it issues the same requests a curl
// would, against the same routes, and returns the same wire objects §4.6
// produces". Nothing here reshapes a payload - scoping, tiering and secret
// exclusion are enforced server-side, once, on a surface this package cannot
// bypass. That is the property that makes a client on someone else's machine
// acceptable at all, and it is why this file has no business logic in it.
import type { Config } from "./config.js";
import { errorCauses, type ErrorCause } from "./diagnostics.js";
import type { OpenApiOperation } from "./openapi.js";

/** Set by the API from 7 days before the key expires (OpenAPI components.headers). */
export const KEY_EXPIRY_HEADER = "Squally-Key-Expires-At";

export type ApiSuccess = {
  kind: "success";
  data: unknown;
  /** The header's value when present, otherwise null. */
  keyExpiresAt: string | null;
};

export type ApiFailure = {
  kind: "failure";
  status: number;
  /** The API's own sentence, when it sent a body. */
  message: string | null;
  /** The API's stable slug, when it sent a body. */
  code: string | null;
};

/** The request never reached the API, or the answer was not JSON. */
export type ApiUnreachable = {
  kind: "unreachable";
  detail: string;
  /** error.cause and below - where "fetch failed" keeps its reason. */
  causes: ErrorCause[];
  url: string;
};

export type ApiResult = ApiSuccess | ApiFailure | ApiUnreachable;

/**
 * Builds the request URL.
 *
 * PATH VALUES ARE ENCODED, and the one that matters is testName. A Playwright
 * test name contains "/" whenever the spec file sits in a folder, and the API
 * expects it as %2F - read-api-mcp-spec §4.2 measured exactly this: "%2F
 * matches the [testName] route and arrives decoded; an unencoded a/b is a
 * different path and 404s". encodeURIComponent does that, and leaves the rest
 * of the name alone.
 */
export function buildUrl(
  apiBase: string,
  operation: OpenApiOperation,
  args: Record<string, unknown>,
): string {
  let path = operation.path;
  for (const parameter of operation.parameters) {
    if (parameter.in !== "path") continue;
    const value = args[parameter.name];
    path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
  }

  const query = new URLSearchParams();
  for (const parameter of operation.parameters) {
    if (parameter.in !== "query") continue;
    const value = args[parameter.name];
    // Omitted rather than sent empty: the API is strict about query values and
    // answers invalid_parameter rather than falling back to a default, so an
    // empty string would turn "not specified" into a 400.
    if (value === undefined || value === null || value === "") continue;
    query.set(parameter.name, String(value));
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `${apiBase}${path}${suffix}`;
}

export type Fetcher = typeof fetch;

/**
 * Removes the key from text a network stack produced. No stack is known to
 * echo a request header into an error, but these strings go to the model and
 * to the client's log, and "never the key" should not rest on that.
 */
function withoutKey(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join("[redacted]") : text;
}

function unreachable(error: unknown, detail: string, url: string, apiKey: string): ApiUnreachable {
  return {
    kind: "unreachable",
    detail: withoutKey(detail, apiKey),
    causes: errorCauses(error).map((cause) => ({
      code: cause.code === null ? null : withoutKey(cause.code, apiKey),
      message: withoutKey(cause.message, apiKey),
    })),
    url,
  };
}

export async function callOperation(
  config: Config,
  operation: OpenApiOperation,
  args: Record<string, unknown>,
  fetcher: Fetcher = fetch,
): Promise<ApiResult> {
  const url = buildUrl(config.apiBase, operation, args);

  let response: Response;
  try {
    response = await fetcher(url, {
      method: operation.method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        accept: "application/json",
        "user-agent": config.userAgent,
      },
    });
  } catch (error) {
    return unreachable(error, error instanceof Error ? error.message : String(error), url, config.apiKey);
  }

  if (response.ok) {
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      // A 200 that is not JSON is almost always a proxy or a login page
      // wearing our status code - worth saying so rather than reporting a
      // parse error the user cannot place.
      return unreachable(
        error,
        `the response was not JSON (${error instanceof Error ? error.message : String(error)})`,
        url,
        config.apiKey,
      );
    }
    return { kind: "success", data, keyExpiresAt: response.headers.get(KEY_EXPIRY_HEADER) };
  }

  // 429 carries no body - it comes from the edge firewall, not the
  // application (§4.5, and x-error-codes marks it hasBody: false). Every other
  // status is expected to carry {error, code}; a missing body is tolerated
  // rather than treated as a second failure.
  let message: string | null = null;
  let code: string | null = null;
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown };
    if (typeof body?.error === "string") message = body.error;
    if (typeof body?.code === "string") code = body.code;
  } catch {
    // Left null; the caller has a sentence for every status either way.
  }

  return { kind: "failure", status: response.status, message, code };
}
