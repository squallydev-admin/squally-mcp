// Argument validation, built from the same parameter list the tool advertises.
//
// WHY VALIDATE AT ALL when the tool already ships an inputSchema: the schema
// is a hint to the client, not a guarantee to the server. Clients differ in
// how strictly they enforce it and some do not enforce it at all, so an
// argument reaching the handler has been checked by nobody. Without this, a
// model passing days=5 would produce a 400 from the API with a sentence about
// a query parameter the model never saw itself write.
//
// Built FROM the OpenAPI parameter schema rather than written beside it, for
// the reason src/openapi.ts gives: two descriptions of one contract drift.
import { z } from "zod";
import { toolParameters, type JsonSchema, type OpenApiOperation } from "./openapi.js";

function stringSchema(schema: JsonSchema): z.ZodType {
  const values = schema["enum"];
  if (Array.isArray(values)) {
    return z.enum(values.map(String) as [string, ...string[]]);
  }
  let out = z.string();
  const min = schema["minLength"];
  const max = schema["maxLength"];
  const pattern = schema["pattern"];
  if (typeof min === "number") out = out.min(min);
  if (typeof max === "number") out = out.max(max);
  if (typeof pattern === "string") out = out.regex(new RegExp(pattern));
  return out;
}

function integerSchema(schema: JsonSchema): z.ZodType {
  const values = schema["enum"];
  if (Array.isArray(values)) {
    const allowed = values.map(Number);
    return z
      .number()
      .int()
      .refine((n) => allowed.includes(n), {
        message: `must be one of: ${allowed.join(", ")}`,
      });
  }
  let out = z.number().int();
  const minimum = schema["minimum"];
  if (typeof minimum === "number") out = out.min(minimum);
  return out;
}

function forParameter(schema: JsonSchema): z.ZodType {
  switch (schema["type"]) {
    case "integer":
    case "number":
      return integerSchema(schema);
    case "boolean":
      return z.boolean();
    case "string":
    default:
      return stringSchema(schema);
  }
}

/**
 * A validator for one operation's arguments.
 *
 * `.strict()` mirrors the advertised `additionalProperties: false`: an unknown
 * argument is reported rather than dropped, because a dropped `branch` reads
 * to the agent as "no runs on that branch" rather than as "I made that
 * parameter up".
 */
export function validatorFor(operation: OpenApiOperation): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  // The parameters the tool offers, not all the operation has: one the tool
  // leaves out (OMITTED_PARAMETERS) is refused like any invented one.
  for (const parameter of toolParameters(operation)) {
    const base = forParameter(parameter.schema);
    shape[parameter.name] = parameter.required ? base : base.optional();
  }
  return z.object(shape).strict();
}

export type ValidationResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; message: string };

/** One sentence naming every problem, so a model can fix them all in one retry. */
export function validateArgs(
  operation: OpenApiOperation,
  raw: unknown,
): ValidationResult {
  const parsed = validatorFor(operation).safeParse(raw ?? {});
  if (parsed.success) return { ok: true, args: parsed.data as Record<string, unknown> };

  const problems = parsed.error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join(".") : "(arguments)";
    return `${where}: ${issue.message}`;
  });
  return {
    ok: false,
    message: `Invalid arguments for this tool - ${problems.join("; ")}.`,
  };
}
