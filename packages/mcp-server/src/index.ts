#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServerFromEnv } from "./server";

const server = createMcpServerFromEnv();
const transport = new StdioServerTransport();
await server.connect(transport);
