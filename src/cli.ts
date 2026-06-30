#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGrippMcpServer } from "./mcpServer.js";

const server = createGrippMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
