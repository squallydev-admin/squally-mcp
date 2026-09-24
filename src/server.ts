// The MCP server: seven tools over stdio, each one HTTP GET.
//
// THE LOW-LEVEL Server RATHER THAN McpServer.registerTool, deliberately. The
// tool schemas here are not authored in TypeScript - they are lifted out of
// the OpenAPI document (src/openapi.ts) and must reach the client byte for
// byte, because read-api-mcp-spec §10e makes them a contract ("schemas are a
// contract with clients and must not drift silently") and test/schemas.test.js
// pins them. registerTool would take a Zod shape and generate its own JSON
// Schema, putting a translation layer between the document and the wire.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { callOperation, type Fetcher } from "./api.js";
import { INSTRUCTIONS } from "./instructions.js";
import { inputSchemaFor, loadDocument, operationFor, outputSchemaFor } from "./openapi.js";
import { toolResult } from "./result.js";
import { ANNOTATIONS, TOOLS } from "./tools.js";
import { validateArgs } from "./validate.js";

export const SERVER_NAME = "squally";

/** The tool list as it goes on the wire - also what the schema tests assert. */
export function toolList(): Tool[] {
  return TOOLS.map((tool) => {
    const operation = operationFor(tool.operationId);
    return {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: inputSchemaFor(operation) as Tool["inputSchema"],
      outputSchema: outputSchemaFor(operation) as Tool["outputSchema"],
      annotations: ANNOTATIONS,
    };
  });
}

export function createServer(config: Config, version: string, fetcher: Fetcher = fetch): Server {
  const document = loadDocument();
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

  const server = new Server(
    { name: SERVER_NAME, version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }

    const operation = operationFor(tool.operationId);
    const validated = validateArgs(operation, request.params.arguments);
    if (!validated.ok) {
      return { content: [{ type: "text", text: validated.message }], isError: true };
    }

    const result = await callOperation(config, operation, validated.args, fetcher);
    return toolResult(result, document.errorCodes, config.apiBase);
  });

  return server;
}
