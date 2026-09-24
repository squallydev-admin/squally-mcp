// tsc compiles .ts and ignores everything else, so the vendored OpenAPI
// document has to be copied into dist/ by hand. It is loaded at runtime from
// beside the compiled code (src/openapi.ts), and `files: ["dist"]` means this
// copy - not the one in src/ - is what ships to npm.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FROM = join(HERE, "..", "src", "openapi", "v1.json");
const TO = join(HERE, "..", "dist", "openapi", "v1.json");

mkdirSync(dirname(TO), { recursive: true });
copyFileSync(FROM, TO);
console.log("[build] copied src/openapi/v1.json -> dist/openapi/v1.json");
