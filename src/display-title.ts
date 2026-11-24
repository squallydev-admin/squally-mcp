// displayTitle on squally-list-errors' answer, for a server that predates it.
//
// THE READ API 1.0.0-beta.19 (additive, 24.11.2026) gives every error
// signature `displayTitle` - the title the app shows - and `kind`. The vendored
// document makes both required, so a client that validates structured output
// (the MCP SDK's does) would reject the answer of a server from before that
// change. Such an answer gets them here: `displayTitle` from `title`, the
// API's older spelling of the same error ("kind · locator"), and `kind` null -
// unknown, which the schema allows.
//
// THE ONE EXCEPTION to "the API's JSON verbatim" (src/result.ts), and a narrow
// one: listErrors only, only a signature that lacks the field, nothing else
// touched. An answer that has them is returned as the same object.

/** The operation whose answer names errors - squally-list-errors. */
const OPERATION = "listErrors";

type Signature = Record<string, unknown> & { title?: unknown; displayTitle?: unknown };

function completed(signature: Signature): Signature {
  if (typeof signature.displayTitle === "string") return signature;
  const { title } = signature;
  return {
    ...signature,
    displayTitle: typeof title === "string" ? title : "",
    kind: typeof signature.kind === "string" ? signature.kind : null,
  };
}

/** `data` with every error signature carrying displayTitle and kind - see above. */
export function withDisplayTitles(operationId: string, data: unknown): unknown {
  if (operationId !== OPERATION || typeof data !== "object" || data === null) return data;
  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return data;
  const missing = errors.some(
    (e) => typeof e === "object" && e !== null && typeof (e as Signature).displayTitle !== "string",
  );
  if (!missing) return data;
  return {
    ...(data as Record<string, unknown>),
    errors: errors.map((e) => (typeof e === "object" && e !== null ? completed(e as Signature) : e)),
  };
}
