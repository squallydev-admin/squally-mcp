// Turning an API answer into an MCP tool result.
//
// SUCCESS carries structuredContent - the API's JSON, unchanged - plus a text
// block, because a client that does not read structuredContent still has to
// show the model something. The text is the same JSON; there is no second,
// prettier rendering to drift from the first.
//
// FAILURE is an isError result rather than a thrown exception. A thrown error
// crosses to the model as a protocol failure with no vocabulary; an isError
// result carries the API's own sentence, its stable code and the ACTION from
// the document's x-error-codes - which is what the server instructions tell
// the model to follow.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiFailure, ApiResult, ApiUnreachable } from "./api.js";
import { describeFailure } from "./diagnostics.js";
import type { ErrorCode } from "./openapi.js";

/** The one message for a rate limit, which arrives without a body. */
export const RATE_LIMITED_TEXT = "Rate limited - wait 60 seconds, then retry.";

function text(value: string): CallToolResult["content"][number] {
  return { type: "text", text: value };
}

/**
 * The line appended when the key is within 7 days of expiring.
 *
 * One line, on every successful call, for as long as the header is sent. It is
 * the only warning the user gets: the key stops working on that date and there
 * is no renewal (spec §2.2.2), so a quiet expiry would read to an agent as the
 * API having broken.
 */
export function expiryLine(isoDate: string): string {
  const parsed = new Date(isoDate);
  const shown = Number.isNaN(parsed.getTime())
    ? isoDate
    : parsed.toISOString().slice(0, 10);
  return `Note: this Squally read key expires on ${shown}. Create a new one in Settings -> API keys before then; expired keys are not renewed.`;
}

export function successResult(data: unknown, keyExpiresAt: string | null): CallToolResult {
  const content = [text(JSON.stringify(data, null, 2))];
  if (keyExpiresAt) content.push(text(expiryLine(keyExpiresAt)));
  return {
    content,
    // The API's JSON verbatim. The tool's outputSchema is that operation's own
    // 200 schema, so the client can validate this without trusting us.
    structuredContent: data as Record<string, unknown>,
  };
}

export function failureResult(
  failure: ApiFailure,
  errorCodes: Map<string, ErrorCode>,
): CallToolResult {
  if (failure.status === 429) {
    return { content: [text(RATE_LIMITED_TEXT)], isError: true };
  }

  const known = failure.code ? errorCodes.get(failure.code) : undefined;
  const lines: string[] = [];

  lines.push(failure.message ?? `The Squally API answered HTTP ${failure.status}.`);
  if (failure.code) lines.push(`Error code: ${failure.code}`);
  if (known) {
    lines.push(`What to do: ${known.action}`);
  } else if (failure.status >= 500) {
    // Not in the catalogue, but the document states one retry rule for 5xx and
    // an agent that retries a 500 immediately, forever, is the failure mode.
    lines.push("What to do: retry with exponential backoff from 1 second, capped at 30 seconds.");
  }

  return { content: [text(lines.join("\n"))], isError: true };
}

/**
 * WITH THE CAUSES: "fetch failed" alone names no reason; error.cause says
 * whether it was DNS, a refused connect, a timeout or a certificate
 * (src/diagnostics.ts).
 */
export function unreachableResult(failure: ApiUnreachable, apiBase: string): CallToolResult {
  return {
    content: [
      text(
        `Could not reach the Squally API at ${apiBase} (${describeFailure(failure.detail, failure.causes)}). ` +
          "Check that the host is correct and reachable; if SQUALLY_API_URL is set, it should be " +
          "a base URL such as https://app.squally.dev.",
      ),
    ],
    isError: true,
  };
}

export function toolResult(
  result: ApiResult,
  errorCodes: Map<string, ErrorCode>,
  apiBase: string,
): CallToolResult {
  switch (result.kind) {
    case "success":
      return successResult(result.data, result.keyExpiresAt);
    case "failure":
      return failureResult(result, errorCodes);
    case "unreachable":
      return unreachableResult(result, apiBase);
  }
}
