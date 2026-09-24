#!/usr/bin/env node
// squally-mcp - a local MCP server over stdio for Squally's read API.
//
// STDERR FOR EVERYTHING HUMAN. stdout is the MCP transport: one stray
// console.log there corrupts the JSON-RPC stream and the client reports a
// protocol error rather than the message that was written. Every diagnostic
// below therefore goes to stderr, which clients surface as the server's log.
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig } from "./config.js";
import { createServer } from "./server.js";

/** Read at runtime rather than imported: npm always ships package.json, and a
 *  JSON import would need an assertion that varies across Node versions. */
function version(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const v = version();
  const resolved = resolveConfig(process.env, v);

  if (!resolved.ok) {
    // One line, then stop. A server that starts without a key would answer
    // every tool call with the same 401 and leave the user reading API errors
    // for a configuration problem.
    console.error(`squally-mcp: ${resolved.message}`);
    process.exit(1);
  }

  const server = createServer(resolved.config, v);
  await server.connect(new StdioServerTransport());
  console.error(`squally-mcp ${v} ready - ${resolved.config.apiBase}`);
}

main().catch((error) => {
  console.error(`squally-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
