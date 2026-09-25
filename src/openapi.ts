// The vendored OpenAPI document, and the two schemas each tool is built from.
//
// DERIVED, NOT TRANSCRIBED. A tool's inputSchema is the operation's parameter
// list and its outputSchema is the operation's 200 response schema, both read
// out of the document at startup. Hand-writing either would create a second
// description of the same contract, and the two would drift the first time a
// parameter changed - the failure read-api-mcp-spec §4.6 guards against on the
// server side ("two endpoints cannot describe the same run differently").
//
// The document is a file beside the compiled code, never a fetch: see
// scripts/vendor-openapi.mjs for why, and test/drift.test.js for the check
// that keeps the copy honest.
import { readFileSync } from "node:fs";

export type JsonSchema = Record<string, unknown>;

export type OpenApiParameter = {
  name: string;
  in: "path" | "query";
  required?: boolean;
  description?: string;
  schema: JsonSchema;
};

export type OpenApiOperation = {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters: OpenApiParameter[];
  /** The 200 response's schema, with any $ref already resolved. */
  responseSchema: JsonSchema;
};

export type ErrorCode = {
  code: string;
  status: number;
  when: string;
  action: string;
  hasBody: boolean;
};

export type OpenApiDocument = {
  version: string;
  operations: Map<string, OpenApiOperation>;
  errorCodes: Map<string, ErrorCode>;
};

const DOCUMENT_URL = new URL("./openapi/v1.json", import.meta.url);

/** Resolves a local `#/components/...` pointer; other forms are not produced by our generator. */
function resolveRef(raw: Record<string, any>, ref: string): JsonSchema {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref: ${ref}`);
  let node: any = raw;
  for (const part of ref.slice(2).split("/")) {
    node = node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (node === undefined) throw new Error(`$ref does not resolve: ${ref}`);
  }
  return node as JsonSchema;
}

function deref(raw: Record<string, any>, schema: JsonSchema): JsonSchema {
  const ref = schema["$ref"];
  return typeof ref === "string" ? deref(raw, resolveRef(raw, ref)) : schema;
}

export function parseDocument(text: string): OpenApiDocument {
  const raw = JSON.parse(text) as Record<string, any>;
  const operations = new Map<string, OpenApiOperation>();

  for (const [path, methods] of Object.entries(raw.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      if (method === "parameters" || !operation?.operationId) continue;
      const success = operation.responses?.["200"]?.content?.["application/json"]?.schema;
      if (!success) continue;
      operations.set(operation.operationId, {
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary,
        description: operation.description,
        parameters: (operation.parameters ?? []).map((p: any) => ({
          name: p.name,
          in: p.in,
          required: Boolean(p.required),
          description: p.description,
          schema: deref(raw, p.schema ?? {}),
        })),
        responseSchema: deref(raw, success),
      });
    }
  }

  const errorCodes = new Map<string, ErrorCode>();
  for (const entry of (raw["x-error-codes"] ?? []) as ErrorCode[]) {
    errorCodes.set(entry.code, entry);
  }

  return { version: raw.info?.version ?? "unknown", operations, errorCodes };
}

let cached: OpenApiDocument | null = null;

export function loadDocument(): OpenApiDocument {
  if (cached === null) cached = parseDocument(readFileSync(DOCUMENT_URL, "utf8"));
  return cached;
}

export function operationFor(operationId: string): OpenApiOperation {
  const operation = loadDocument().operations.get(operationId);
  if (!operation) {
    // Unreachable through the shipped tool table, and loud rather than silent
    // if the vendored document is ever replaced by one missing an operation:
    // a tool that quietly disappears is worse than a server that will not
    // start.
    throw new Error(`the vendored OpenAPI document has no operation "${operationId}"`);
  }
  return operation;
}

/**
 * Parameter descriptions that must NOT come from the OpenAPI document.
 *
 * The document describes an HTTP request, where the caller builds the URL and
 * therefore has to percent-encode a test name itself. A tool argument is not a
 * URL: src/api.ts encodes it on the way out, so a pre-encoded argument is
 * encoded twice and stops matching anything.
 *
 * MEASURED, NOT ANTICIPATED (24.09., §10e session). Claude Code read the
 * document's "URL-encode it, including \"/\" as %2F" and sent
 * `checkout%20flow%20%3E%20...`. Against the live dev API the raw name
 * resolves to a status and the pre-encoded one answers `test_not_found` - so
 * the model would have reported a test that exists as missing.
 *
 * Deliberately NOT solved by detecting already-encoded input: a test name may
 * legitimately contain a percent sign, so "looks encoded" is a guess, and a
 * client that guesses wrong about its own arguments is worse than one that
 * states the rule plainly.
 */
const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  testName:
    "The full test name as Squally stores it (the Playwright title path), for example " +
    '"checkout flow > completes payment". Pass the name exactly as shown in Squally; ' +
    "do not URL-encode, the server does. A name used in several spec files also needs filePath.",
  filePath:
    "The spec file of the test, as stored (e.g. tests/checkout.spec.ts); an empty value " +
    "means a test with no file. Pass it exactly as shown in Squally; do not URL-encode, " +
    "the server does. Needed only when the name exists in several files - the " +
    "ambiguous_test error lists them.",
  // The document's cursor text sends the caller to direction=prev, which the
  // tool does not offer (OMITTED_PARAMETERS). An agent told to use a parameter
  // it cannot send gets an "invented argument" error for following orders.
  cursor:
    "Opaque. Pass nextCursor from the previous answer for the next page of older runs. " +
    "Without a cursor the newest runs come first.",
};

/**
 * Parameters of the operation that the tools do NOT offer - a deliberate
 * deviation from the OpenAPI document, like PARAMETER_DESCRIPTIONS above.
 *
 * QUIETER TOOLS (25.09., 0.1.3). Every property of an inputSchema sits in the
 * model's context on every turn, and a parameter on offer is a parameter the
 * model spends a decision on. These two answer no question an agent asks:
 *
 *   perPage    the page size is FIXED at the API's default, 10 rows, for
 *              squally-find-run, squally-list-flaky-tests and
 *              squally-list-errors alike. "More" stays one call away:
 *              `cursor` (runs) and `page` (flaky tests, errors) are kept.
 *   direction  paging back towards newer runs is a person's gesture; an agent
 *              that wants the newest runs calls again without a cursor.
 *
 * Left out of the input schema AND the validator (src/validate.ts), so an
 * agent that sends one is told it made the argument up, and none is ever
 * forwarded. test/drift.test.js checks that both are still optional upstream
 * and that the default page size is still 10 - the moment either stops being
 * true, this deviation stops being harmless.
 */
export const OMITTED_PARAMETERS: ReadonlySet<string> = new Set(["perPage", "direction"]);

/** The parameters a tool offers: the operation's, minus OMITTED_PARAMETERS. */
export function toolParameters(operation: OpenApiOperation): OpenApiParameter[] {
  return operation.parameters.filter((parameter) => !OMITTED_PARAMETERS.has(parameter.name));
}

/**
 * The operation's parameters as one JSON Schema object.
 *
 * `additionalProperties: false` on purpose: a model that invents a parameter
 * should be told, not silently ignored - an ignored `?branch=` reads to the
 * agent as "there are no runs on that branch".
 *
 * Descriptions come from the document except for those in
 * PARAMETER_DESCRIPTIONS - see there for why those cannot - and the parameters
 * in OMITTED_PARAMETERS are not offered at all.
 */
export function inputSchemaFor(operation: OpenApiOperation): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const parameter of toolParameters(operation)) {
    const { description, ...rest } = parameter.schema as Record<string, unknown>;
    const override = PARAMETER_DESCRIPTIONS[parameter.name];
    const text = override ?? parameter.description ?? (description as string | undefined);
    properties[parameter.name] = text === undefined ? { ...rest } : { ...rest, description: text };
    if (parameter.required) required.push(parameter.name);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

export function outputSchemaFor(operation: OpenApiOperation): JsonSchema {
  return operation.responseSchema;
}
