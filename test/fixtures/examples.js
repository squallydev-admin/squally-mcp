// Response fixtures: the examples the vendored OpenAPI document itself gives.
//
// READ FROM THE DOCUMENT, NOT COPIED OUT OF IT. Every operation in
// src/openapi/v1.json carries an example for its 200 and for each error it can
// answer (squally-app generates them beside the schemas). A copy in this
// folder would be a second description of the same contract - the thing
// src/openapi.ts refuses to have for schemas - and would keep asserting the
// old shapes after the next re-vendor. Read from the file, a re-vendored
// document brings its own new fixtures, and test/examples.test.js checks them
// against the schemas the tools publish.
import { readFileSync } from "node:fs";

const DOCUMENT = JSON.parse(
  readFileSync(new URL("../../src/openapi/v1.json", import.meta.url), "utf8"),
);

function operationById(operationId) {
  for (const methods of Object.values(DOCUMENT.paths)) {
    for (const operation of Object.values(methods)) {
      if (operation?.operationId === operationId) return operation;
    }
  }
  throw new Error(`the vendored document has no operation "${operationId}"`);
}

/** A fresh copy of the operation's documented 200 answer. */
export function successExample(operationId) {
  const content = operationById(operationId).responses?.["200"]?.content?.["application/json"];
  if (!content?.example) throw new Error(`${operationId} documents no 200 example`);
  return structuredClone(content.example);
}

/** A fresh copy of the operation's documented error answer for `code`. */
export function errorExample(operationId, status, code) {
  const content = operationById(operationId).responses?.[String(status)]?.content?.["application/json"];
  const value = content?.examples?.[code]?.value ?? (content?.example?.code === code ? content.example : undefined);
  if (!value) throw new Error(`${operationId} documents no ${status} ${code} example`);
  return structuredClone(value);
}
