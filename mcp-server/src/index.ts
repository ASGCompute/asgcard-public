#!/usr/bin/env node

/**
 * @asgcard/mcp-server — Entry point
 *
 * Starts the ASGCard MCP server with stdio transport.
 * Used by Claude Code, Claude Desktop, and Cursor.
 *
 * Required env vars:
 *   STELLAR_PRIVATE_KEY — Stellar secret key (S...) for signing x402 payments
 *
 * Optional env vars:
 *   ASGCARD_API_URL     — API base URL (default: https://api.asgcard.dev)
 *   STELLAR_RPC_URL     — Soroban RPC URL (default: https://mainnet.sorobanrpc.com)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createASGCardServer } from "./server.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve the Stellar private key.
 * Priority:
 *   1. STELLAR_PRIVATE_KEY env var (explicit override)
 *   2. ~/.asgcard/wallet.json → secretKey (CLI-managed local state)
 *   3. ~/.asgcard/config.json → privateKey (legacy `asgcard login`)
 */
function resolvePrivateKey(): string | undefined {
  if (process.env.STELLAR_PRIVATE_KEY) return process.env.STELLAR_PRIVATE_KEY;

  const asgDir = join(homedir(), ".asgcard");

  // Try wallet.json first (canonical, written by `asgcard wallet create/import`)
  try {
    const wallet = JSON.parse(readFileSync(join(asgDir, "wallet.json"), "utf-8"));
    if (wallet?.secretKey) return wallet.secretKey;
  } catch { /* not found */ }

  // Try config.json (legacy, written by `asgcard login`)
  try {
    const config = JSON.parse(readFileSync(join(asgDir, "config.json"), "utf-8"));
    if (config?.privateKey) return config.privateKey;
  } catch { /* not found */ }

  return undefined;
}

const privateKey = resolvePrivateKey();

if (!privateKey) {
  console.error(
    "❌ STELLAR_PRIVATE_KEY not found.\n\n" +
      "The MCP server looks for your Stellar secret key in this order:\n" +
      "  1. STELLAR_PRIVATE_KEY environment variable\n" +
      "  2. ~/.asgcard/wallet.json (created by `asgcard wallet create`)\n" +
      "  3. ~/.asgcard/config.json (created by `asgcard login`)\n\n" +
      "To fix this:\n" +
      "  npx @asgcard/cli wallet create    (generates a new keypair)\n" +
      "  npx @asgcard/cli onboard          (does everything in one step)\n"
  );
  process.exit(1);
}

const server = createASGCardServer({
  privateKey,
  apiUrl: process.env.ASGCARD_API_URL,
  rpcUrl: process.env.STELLAR_RPC_URL,
});

const transport = new StdioServerTransport();

await server.connect(transport);
