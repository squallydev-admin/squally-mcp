// Fetches the published OpenAPI document and writes it into src/openapi/.
//
// WHY VENDORED AND COMMITTED. The tool schemas are derived from this document
// (see src/openapi.ts): a tool's inputSchema is the operation's parameters and
// its outputSchema is the operation's 200 response schema. Deriving them at
// RUNTIME from the network would mean an MCP server that cannot list its tools
// while offline, and whose tool contract silently changes under a running
// agent. So the document is fetched here, by a human running a script, and the
// result is committed and reviewed like any other source file.
//
// The counterpart is test/drift.test.js, which compares this copy against the
// live document and fails loudly when they have diverged - vendoring without
// that check is just a stale copy with extra steps.
//
//   node scripts/vendor-openapi.mjs                 # from the default host
//   node scripts/vendor-openapi.mjs --from <url>
//   node scripts/vendor-openapi.mjs --from <path>   # a local checkout
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "..", "src", "openapi", "v1.json");
const DEFAULT_SOURCE = "https://app.squally.dev/openapi/v1.json";

/** The operations the tools need; a document without them is not usable. */
const REQUIRED_OPERATIONS = [
  "listProjects",
  "listRuns",
  "getRun",
  "getRunTestAttempts",
  "getTestStatus",
  "listFlakyTests",
  "listErrors",
];

function sourceArg() {
  const i = process.argv.indexOf("--from");
  return i === -1 ? DEFAULT_SOURCE : process.argv[i + 1];
}

async function read(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${source} answered ${response.status}`);
    return await response.text();
  }
  const path = resolve(source);
  if (!existsSync(path)) throw new Error(`no such file: ${path}`);
  return readFileSync(path, "utf8");
}

async function main() {
  const source = sourceArg();
  console.log(`[vendor] source: ${source}`);
  const text = await read(source);

  // Parsed before writing, so a truncated download or an HTML error page never
  // lands in src/ looking like a document.
  const doc = JSON.parse(text);
  if (!doc.paths || !doc.components?.schemas) {
    throw new Error("not an OpenAPI document: no paths or components.schemas");
  }

  const seen = new Set();
  for (const operations of Object.values(doc.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (method === "parameters") continue;
      if (operation.operationId) seen.add(operation.operationId);
    }
  }
  const missing = REQUIRED_OPERATIONS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`the document is missing operations this server needs: ${missing.join(", ")}`);
  }

  const previous = existsSync(TARGET) ? readFileSync(TARGET, "utf8") : null;
  // Re-serialised rather than written through, so the committed file has one
  // stable formatting and a diff shows content changes only.
  const next = JSON.stringify(doc, null, 2) + "\n";
  writeFileSync(TARGET, next);

  console.log(`[vendor] api version: ${doc.info?.version ?? "?"}`);
  console.log(`[vendor] operations : ${seen.size} (all ${REQUIRED_OPERATIONS.length} required ones present)`);
  console.log(
    previous === null
      ? "[vendor] written (new file)"
      : previous === next
        ? "[vendor] unchanged"
        : "[vendor] UPDATED - review the diff before committing",
  );
}

main().catch((error) => {
  console.error(`[vendor] failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
