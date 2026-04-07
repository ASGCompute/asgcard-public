#!/usr/bin/env node

/**
 * @asgcard/cli — ASG Card command line interface
 *
 * Manage virtual cards for AI agents from your terminal.
 * Primary rail: Stellar x402 (autonomous, no human needed).
 * Fallback rail: Stripe MPP (owner-in-the-loop, when USDC unavailable).
 *
 * Onboarding commands:
 *   asgcard install --client codex|claude|cursor  — Configure MCP for your AI client
 *   asgcard onboard [-y]                          — Full onboarding: wallet + MCP + skill + next step
 *   asgcard wallet create                         — Generate a new Stellar keypair
 *   asgcard wallet import                         — Import an existing Stellar secret key
 *   asgcard wallet info                           — Show wallet address, USDC balance, deposit info
 *   asgcard doctor                                — Diagnose your setup
 *
 * Card commands (Stellar x402 — primary):
 *   asgcard card:create        — Create a new card (x402 payment)
 *   asgcard card:fund <id>     — Fund a card (x402 payment)
 *   asgcard cards              — List your cards
 *   asgcard card <id>          — Get card details
 *   asgcard card:details <id>  — Get sensitive card info (PAN, CVV)
 *   asgcard card:freeze <id>   — Freeze a card
 *   asgcard card:unfreeze <id> — Unfreeze a card
 *
 * Stripe fallback commands:
 *   asgcard stripe:session <email>    — Create or view Stripe session
 *   asgcard stripe:request            — Create a Stripe payment request
 *   asgcard stripe:status <id>        — Check payment request status
 *   asgcard stripe:wait <id>          — Wait for payment request completion
 *
 * Telegram notifications:
 *   asgcard telegram:link             — Generate deep-link to connect Telegram
 *   asgcard telegram:status           — Check Telegram connection status
 *   asgcard telegram:revoke           — Disconnect Telegram notifications
 *
 * Utility:
 *   asgcard pricing            — View pricing
 *   asgcard health             — API health check
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ASGCardClient } from "@asgcard/sdk";
import { WalletClient } from "./wallet-client.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

// ── Constants ───────────────────────────────────────────────

const __require = createRequire(import.meta.url);
const { version: VERSION } = __require("../package.json") as { version: string };

const CONFIG_DIR = join(homedir(), ".asgcard");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const WALLET_FILE = join(CONFIG_DIR, "wallet.json");
const STRIPE_SESSION_FILE = join(CONFIG_DIR, "stripe-session.json");
const SKILL_DIR = join(homedir(), ".agents", "skills", "asgcard");

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const HORIZON_URL = "https://horizon.stellar.org";
// Pricing constants (must match api/src/config/pricing.ts)
const CARD_FEE = 10;
const TOPUP_RATE = 0.035;
const MIN_CREATE_COST = CARD_FEE; // $10 flat card creation (initial load optional)

// ── Config persistence ──────────────────────────────────────

interface Config {
  privateKey?: string;
  apiUrl?: string;
  rpcUrl?: string;
}

interface WalletState {
  publicKey: string;
  secretKey: string;
  createdAt: string;
}

interface StripeSessionState {
  sessionId: string;
  ownerId: string;
  sessionKey: string;
  managedWalletAddress: string;
  email: string;
  createdAt: string;
}

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {
    // ignore
  }
  return {};
}

function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function loadWallet(): WalletState | null {
  try {
    if (existsSync(WALLET_FILE)) {
      return JSON.parse(readFileSync(WALLET_FILE, "utf-8"));
    }
  } catch {
    // ignore
  }
  return null;
}

function saveWallet(wallet: WalletState): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2), { mode: 0o600 });
}

function loadStripeSession(): StripeSessionState | null {
  try {
    if (existsSync(STRIPE_SESSION_FILE)) {
      return JSON.parse(readFileSync(STRIPE_SESSION_FILE, "utf-8"));
    }
  } catch {
    // ignore
  }
  return null;
}

function saveStripeSession(session: StripeSessionState): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(STRIPE_SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

function clearStripeSession(): void {
  try {
    if (existsSync(STRIPE_SESSION_FILE)) {
      unlinkSync(STRIPE_SESSION_FILE);
    }
  } catch {
    // ignore
  }
}

function requireStripeSession(): StripeSessionState {
  const session = loadStripeSession();
  if (!session) {
    console.error(
      chalk.red("❌ No Stripe session. Create one first:\n\n") +
        chalk.cyan("  asgcard stripe:session <email>\n")
    );
    process.exit(1);
  }
  return session;
}

function resolveKey(): string | null {
  // Priority: env var > wallet.json > config.json (legacy)
  // Must match mcp-server/src/index.ts resolvePrivateKey() order
  if (process.env.STELLAR_PRIVATE_KEY) return process.env.STELLAR_PRIVATE_KEY;
  const wallet = loadWallet();
  if (wallet?.secretKey) return wallet.secretKey;
  const config = loadConfig();
  if (config.privateKey) return config.privateKey;
  return null;
}

function requireKey(): string {
  const key = resolveKey();
  if (!key) {
    console.error(
      chalk.red("❌ No Stellar private key configured.\n\n") +
        chalk.bold("To fix this, do one of:\n\n") +
        chalk.cyan("  asgcard wallet create") +
        chalk.dim("    — generate a new Stellar keypair\n") +
        chalk.cyan("  asgcard wallet import") +
        chalk.dim("   — import an existing key\n") +
        chalk.cyan("  asgcard login <key>") +
        chalk.dim("     — save a key directly\n") +
        chalk.dim("\n  Or set ") +
        chalk.cyan("STELLAR_PRIVATE_KEY") +
        chalk.dim(" environment variable.\n")
    );
    process.exit(1);
  }
  return key;
}

function getApiUrl(): string {
  return process.env.ASGCARD_API_URL || loadConfig().apiUrl || "https://api.asgcard.dev";
}

function getRpcUrl(): string | undefined {
  return process.env.STELLAR_RPC_URL || loadConfig().rpcUrl;
}

// ── Stellar Horizon helpers ─────────────────────────────────

async function getUsdcBalance(publicKey: string): Promise<number> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (res.status === 404) return 0; // Account not funded
    if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
    const data = await res.json() as { balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }> };
    const usdcBalance = data.balances.find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
    );
    return usdcBalance ? parseFloat(usdcBalance.balance) : 0;
  } catch {
    return -1; // -1 signals error
  }
}

async function isAccountFunded(publicKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Formatters ──────────────────────────────────────────────

function formatCard(card: Record<string, unknown>): string {
  const status = card.status === "active"
    ? chalk.green("● active")
    : card.status === "frozen"
      ? chalk.blue("❄ frozen")
      : chalk.dim(String(card.status));

  return [
    `  ${chalk.bold(String(card.cardId || card.id || ""))}`,
    `  Name:    ${card.nameOnCard || card.name || "—"}`,
    `  Balance: ${chalk.green("$" + (card.balance ?? "?"))}`,
    `  Status:  ${status}`,
    `  Created: ${card.createdAt || "—"}`,
  ].join("\n");
}

function remediate(what: string, why: string, fix: string): void {
  console.error(
    chalk.red(`❌ ${what}\n`) +
      chalk.dim(`   Why: ${why}\n`) +
      chalk.bold(`   Fix: `) + chalk.cyan(fix) + "\n"
  );
}

// ── CLI ─────────────────────────────────────────────────────

const program = new Command();

program
  .name("asgcard")
  .description("ASG Card CLI — virtual cards for AI agents, powered by x402 on Stellar")
  .version(VERSION);

// ═══════════════════════════════════════════════════════════
// ONBOARDING COMMANDS
// ═══════════════════════════════════════════════════════════

// ── wallet ──────────────────────────────────────────────────

const walletCmd = program
  .command("wallet")
  .description("Manage your Stellar wallet (create, import, info)");

walletCmd
  .command("create")
  .description("Generate a new Stellar keypair and save locally")
  .action(async () => {
    const existing = loadWallet();
    if (existing) {
      console.log(
        chalk.yellow("⚠ A wallet already exists:\n") +
          chalk.dim("   Address: ") + chalk.cyan(existing.publicKey) + "\n" +
          chalk.dim("   File:    ") + chalk.dim(WALLET_FILE) + "\n\n" +
          chalk.dim("   To replace it, delete ") + chalk.cyan(WALLET_FILE) + chalk.dim(" first.")
      );
      return;
    }

    const { Keypair } = await import("@stellar/stellar-sdk");
    const kp = Keypair.random();

    const wallet: WalletState = {
      publicKey: kp.publicKey(),
      secretKey: kp.secret(),
      createdAt: new Date().toISOString(),
    };
    saveWallet(wallet);

    // Also save to config for backward compatibility
    const config = loadConfig();
    config.privateKey = kp.secret();
    saveConfig(config);

    console.log(chalk.green("✅ Wallet created!\n"));
    console.log(chalk.dim("   Address:    ") + chalk.cyan(kp.publicKey()));
    console.log(chalk.dim("   Secret:     ") + chalk.yellow(kp.secret()));
    console.log(chalk.dim("   Saved to:   ") + chalk.dim(WALLET_FILE));
    console.log();
    console.log(chalk.bold("⚡ Next steps:\n"));
    console.log(chalk.dim("   1. Fund your wallet with at least ") + chalk.green(`$${MIN_CREATE_COST} USDC`) + chalk.dim(" on Stellar"));
    console.log(chalk.dim("      Send USDC to: ") + chalk.cyan(kp.publicKey()));
    console.log(chalk.dim("   2. Check your balance: ") + chalk.cyan("asgcard wallet info"));
    console.log(chalk.dim("   3. Create your first card: ") + chalk.cyan("asgcard card:create -a 10 -n \"AI Agent\" -e you@email.com -p +1234567890"));
    console.log();
    console.log(chalk.yellow("⚠ Back up your secret key! It cannot be recovered if lost."));
  });

walletCmd
  .command("import")
  .description("Import an existing Stellar secret key")
  .argument("[key]", "Stellar secret key (S...). Omit to enter interactively")
  .action(async (key?: string) => {
    let privateKey = key;

    if (!privateKey) {
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      privateKey = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan("Enter Stellar secret key (S...): "), (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
    }

    if (!privateKey?.startsWith("S") || privateKey.length !== 56) {
      remediate(
        "Invalid Stellar secret key",
        "Key must start with 'S' and be 56 characters (Stellar Ed25519 format)",
        "Get your key from your Stellar wallet or run: asgcard wallet create"
      );
      process.exit(1);
    }

    try {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(privateKey);

      const wallet: WalletState = {
        publicKey: kp.publicKey(),
        secretKey: privateKey,
        createdAt: new Date().toISOString(),
      };
      saveWallet(wallet);

      const config = loadConfig();
      config.privateKey = privateKey;
      saveConfig(config);

      console.log(chalk.green("✅ Wallet imported!\n"));
      console.log(chalk.dim("   Address:  ") + chalk.cyan(kp.publicKey()));
      console.log(chalk.dim("   Saved to: ") + chalk.dim(WALLET_FILE));
      console.log();
      console.log(chalk.dim("   Check your balance: ") + chalk.cyan("asgcard wallet info"));
    } catch {
      remediate(
        "Invalid Stellar secret key",
        "Could not decode the provided key",
        "Make sure it's a valid Stellar secret key starting with 'S'"
      );
      process.exit(1);
    }
  });

walletCmd
  .command("info")
  .description("Show wallet address, USDC balance, and deposit instructions")
  .action(async () => {
    const key = resolveKey();
    if (!key) {
      remediate(
        "No wallet configured",
        "No Stellar key found in config, wallet file, or environment",
        "asgcard wallet create  or  asgcard wallet import"
      );
      process.exit(1);
    }

    const spinner = ora("Checking wallet...").start();

    try {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const pubKey = kp.publicKey();

      const funded = await isAccountFunded(pubKey);
      const balance = funded ? await getUsdcBalance(pubKey) : 0;

      spinner.stop();

      console.log(chalk.bold("\n🔑 Wallet Status\n"));
      console.log(chalk.dim("   Public Key:     ") + chalk.cyan(pubKey));
      console.log(chalk.dim("   Account Funded: ") + (funded ? chalk.green("Yes") : chalk.red("No")));

      if (balance === -1) {
        console.log(chalk.dim("   USDC Balance:   ") + chalk.yellow("Could not fetch (Horizon API error)"));
      } else {
        const balanceColor = balance >= MIN_CREATE_COST ? chalk.green : chalk.red;
        console.log(chalk.dim("   USDC Balance:  ") + balanceColor(`$${balance.toFixed(2)} USDC`));
        console.log();
      }

      console.log(chalk.dim("   Min Required:   ") + chalk.dim(`$${MIN_CREATE_COST} USDC (card creation fee, initial load optional)`));
      console.log();

      if (!funded) {
        console.log(chalk.yellow("⚠ Your Stellar account is not funded yet.\n"));
        console.log(chalk.dim("   To activate your account, send at least 1 XLM + USDC to:"));
        console.log(chalk.cyan(`   ${pubKey}`));
        console.log(chalk.dim("\n   Then add a USDC trustline and deposit USDC."));
      } else if (balance < MIN_CREATE_COST) {
        console.log(chalk.yellow("⚠ Insufficient USDC for card creation.\n"));
        console.log();
        console.log(chalk.dim("   Deposit at least ") + chalk.green(`$${MIN_CREATE_COST} USDC`) + chalk.dim(" to your wallet:"));
        console.log(chalk.cyan(`   ${pubKey}`));
        console.log(chalk.dim("\n   USDC on Stellar: ") + chalk.dim("asset code USDC, issuer " + USDC_ISSUER.slice(0, 8) + "..."));
      } else {
        console.log(chalk.green("✅ Wallet is ready for card creation!"));
        console.log(chalk.dim("   Create a card: ") + chalk.cyan("asgcard card:create -a 10 -n \"AI Agent\" -e you@email.com -p +1234567890"));
      }
      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Failed to check wallet"));
      remediate(
        "Invalid private key",
        error instanceof Error ? error.message : "Could not decode key",
        "asgcard wallet create  or  asgcard wallet import"
      );
      process.exit(1);
    }
  });

// ── install ─────────────────────────────────────────────────

program
  .command("install")
  .description("Configure ASG Card MCP server for your AI client")
  .requiredOption("-c, --client <client>", "AI client to configure (codex, claude, cursor)")
  .action(async (options: { client: string }) => {
    const client = options.client.toLowerCase();
    const validClients = ["codex", "claude", "cursor"];

    if (!validClients.includes(client)) {
      remediate(
        `Unknown client: ${client}`,
        `Supported clients: ${validClients.join(", ")}`,
        `asgcard install --client codex`
      );
      process.exit(1);
    }

    // NOTE: We do NOT embed STELLAR_PRIVATE_KEY in client configs.
    // The MCP server reads the key from ~/.asgcard/wallet.json (or config.json)
    // at startup. This keeps wallet lifecycle in the CLI/state layer.

    const key = resolveKey();

    switch (client) {
      case "codex": {
        const configPath = join(homedir(), ".codex", "config.toml");
        const configDir = dirname(configPath);
        mkdirSync(configDir, { recursive: true });

        let existing = "";
        try {
          existing = readFileSync(configPath, "utf-8");
        } catch {
          // file doesn't exist yet
        }

        if (existing.includes("[mcp_servers.asgcard]")) {
          console.log(chalk.yellow("⚠ ASG Card MCP server is already configured in Codex."));
          console.log(chalk.dim("   Config: ") + chalk.dim(configPath));
          return;
        }

        const tomlBlock = `\n[mcp_servers.asgcard]\ncommand = "npx"\nargs = ["-y", "@asgcard/mcp-server"]\n`;

        writeFileSync(configPath, existing + tomlBlock);
        console.log(chalk.green("✅ ASG Card MCP server added to Codex!\n"));
        console.log(chalk.dim("   Config: ") + chalk.dim(configPath));
        console.log(chalk.dim("   Key source: ~/.asgcard/wallet.json (auto-resolved by MCP server)"));
        if (!key) {
          console.log(chalk.yellow("\n⚠ No wallet found yet. Run: ") + chalk.cyan("asgcard wallet create"));
        }
        break;
      }

      case "claude": {
        // Use claude CLI to add MCP server (no env vars — key is read from wallet.json)
        console.log(chalk.bold("Adding ASG Card MCP server to Claude Code...\n"));
        const cmd = `claude mcp add asgcard -- npx -y @asgcard/mcp-server`;

        try {
          execSync(cmd, { stdio: "inherit" });
          console.log(chalk.green("\n✅ ASG Card MCP server added to Claude Code!"));
        } catch {
          // Fallback: write JSON config
          const claudeConfigPath = join(homedir(), ".claude", "mcp.json");
          const claudeConfigDir = dirname(claudeConfigPath);
          mkdirSync(claudeConfigDir, { recursive: true });

          let claudeConfig: Record<string, unknown> = {};
          try {
            claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf-8"));
          } catch {
            // file doesn't exist
          }

          const servers = (claudeConfig.mcpServers || {}) as Record<string, unknown>;
          servers.asgcard = {
            command: "npx",
            args: ["-y", "@asgcard/mcp-server"],
          };
          claudeConfig.mcpServers = servers;

          writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
          console.log(chalk.green("✅ ASG Card MCP server added to Claude config!\n"));
          console.log(chalk.dim("   Config: ") + chalk.dim(claudeConfigPath));
        }

        console.log(chalk.dim("   Key source: ~/.asgcard/wallet.json (auto-resolved by MCP server)"));
        if (!key) {
          console.log(chalk.yellow("\n⚠ No wallet found yet. Run: ") + chalk.cyan("asgcard wallet create"));
        }
        break;
      }

      case "cursor": {
        const cursorConfigPath = join(homedir(), ".cursor", "mcp.json");
        const cursorConfigDir = dirname(cursorConfigPath);
        mkdirSync(cursorConfigDir, { recursive: true });

        let cursorConfig: Record<string, unknown> = {};
        try {
          cursorConfig = JSON.parse(readFileSync(cursorConfigPath, "utf-8"));
        } catch {
          // file doesn't exist
        }

        const servers = (cursorConfig.mcpServers || {}) as Record<string, unknown>;
        if (servers.asgcard) {
          console.log(chalk.yellow("⚠ ASG Card MCP server is already configured in Cursor."));
          console.log(chalk.dim("   Config: ") + chalk.dim(cursorConfigPath));
          return;
        }

        servers.asgcard = {
          command: "npx",
          args: ["-y", "@asgcard/mcp-server"],
        };
        cursorConfig.mcpServers = servers;

        writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2));
        console.log(chalk.green("✅ ASG Card MCP server added to Cursor!\n"));
        console.log(chalk.dim("   Config: ") + chalk.dim(cursorConfigPath));
        console.log(chalk.dim("   Key source: ~/.asgcard/wallet.json (auto-resolved by MCP server)"));
        if (!key) {
          console.log(chalk.yellow("\n⚠ No wallet found yet. Run: ") + chalk.cyan("asgcard wallet create"));
        }
        break;
      }
    }

    console.log(chalk.dim("\n   Verify setup: ") + chalk.cyan("asgcard doctor"));
  });

// ── onboard ─────────────────────────────────────────────────

program
  .command("onboard")
  .description("Full 9-step onboarding: skill → MCP → wallet → API register → TG identity → sponsorship → fund link → balance → status")
  .option("-y, --yes", "Non-interactive mode (auto-create wallet, skip prompts)")
  .option("-c, --client <client>", "AI client to configure (codex, claude, cursor, gemini)")
  .action(async (options: { yes?: boolean; client?: string }) => {
    console.log(chalk.bold("\n🚀 ASG Card Onboarding\n"));

    const TOTAL_STEPS = 9;
    let key = resolveKey();

    // ── Step 1/9: Agent Skill ─────────────────────────────
    console.log(chalk.bold(`Step 1/${TOTAL_STEPS}: Agent Skill`));
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const bundledSkillDir = join(__dirname, "..", "skill");
      if (existsSync(bundledSkillDir)) {
        mkdirSync(SKILL_DIR, { recursive: true });
        cpSync(bundledSkillDir, SKILL_DIR, { recursive: true });
        console.log(chalk.green("  ✅ ASG Card skill installed: ") + chalk.dim(SKILL_DIR));
      } else {
        // Create a minimal skill file
        mkdirSync(SKILL_DIR, { recursive: true });
        const skillContent = `---
name: asgcard
description: ASG Card — virtual MasterCard cards for AI agents, powered by x402 on Stellar
---

# ASG Card Agent Skill

> **CRITICAL: Always use \`npx -y @asgcard/cli@latest\`** (with \`@latest\` tag!) to ensure you are running the newest published version.

## Canonical Flow

1. **Onboard**: Run \`asgcard onboard -y\` to set up wallet, MCP, and skill
2. **Check wallet status**: Use \`get_wallet_status\` MCP tool to verify wallet address and USDC balance
3. **Fund wallet**: Use \`asgcard fund-link\` to get a deposit URL
4. **Check pricing**: Use \`get_pricing\` to see current pricing
5. **Create a card**: Use \`create_card\` with amount, name, and email
6. **Manage cards**: Use \`list_cards\`, \`get_card\`, \`get_card_details\`, \`freeze_card\`, \`unfreeze_card\`

## Zero Balance Handling

If wallet has insufficient USDC:
- Tell the user their current balance and the minimum required
- Provide their Stellar public key for deposits
- Generate a fund link: \`asgcard fund-link\`

## CLI Commands

| Command | Description |
|---------|-------------|
| \`asgcard onboard -y\` | Full 9-step onboarding |
| \`asgcard status\` | Onboarding lifecycle status |
| \`asgcard fund-link\` | Generate deposit URL |
| \`asgcard doctor\` | Diagnose setup issues |
| \`asgcard wallet info\` | Show wallet address & balance |

## MCP Tools (18 tools)

| Tool | Description |
|------|-------------|
| \`get_wallet_status\` | Check wallet address, USDC balance, and readiness |
| \`get_pricing\` | View pricing (card \$10, top-up 3.5%) |
| \`create_card\` | Create virtual MasterCard (pays USDC on-chain via x402) |
| \`list_cards\` | List all wallet cards |
| \`get_card\` | Get card summary |
| \`get_card_details\` | Get PAN, CVV, expiry (sensitive) |
| \`freeze_card\` | Temporarily freeze card |
| \`unfreeze_card\` | Re-enable frozen card |
| \`get_transactions\` | Card transaction history |
| \`get_balance\` | Card balance |
| \`get_onboard_status\` | Onboarding lifecycle status |
| \`connect_telegram\` | Get Telegram deep-link |
| \`get_fund_link\` | Generate fund URL |
| \`get_wallet_balance\` | Wallet USDC balance |
| \`fund_card\` | Top up existing card |
| \`telegram_link\` | TG deep-link (10min expiry) |
| \`telegram_status\` | Check TG connection |
| \`telegram_revoke\` | Disconnect TG |

## Multi-Chain SDK

\`npm install @asgcard/pay\` for multi-chain payments:
Ethereum, Base, Arbitrum, Optimism, Polygon, Solana, Stellar, Stripe, OWS.

## Important Notes

- All payments are in USDC on Stellar via x402 protocol
- Multi-chain via \`@asgcard/pay\` SDK (OWS, EVM, Solana)
- Card details are returned immediately on creation (agent-first model)
- Wallet uses Stellar Ed25519 keypair — private key must stay local
- Card creation costs \$${MIN_CREATE_COST} USDC (flat fee, initial load optional)
`;
        writeFileSync(join(SKILL_DIR, "SKILL.md"), skillContent);
        console.log(chalk.green("  ✅ ASG Card skill installed: ") + chalk.dim(SKILL_DIR));
      }

      // Also install for claude and kiro if dirs exist
      for (const altDir of [
        join(homedir(), ".claude", "skills", "asgcard"),
        join(homedir(), ".kiro", "skills", "asgcard"),
      ]) {
        if (existsSync(dirname(dirname(altDir)))) {
          mkdirSync(altDir, { recursive: true });
          cpSync(SKILL_DIR, altDir, { recursive: true });
        }
      }
    } catch (error) {
      console.log(chalk.yellow("  ⚠ Could not install skill: ") + chalk.dim(error instanceof Error ? error.message : String(error)));
    }
    console.log();

    // ── Step 2/9: MCP Configuration ───────────────────────
    console.log(chalk.bold(`Step 2/${TOTAL_STEPS}: MCP Configuration`));
    const clients: string[] = [];

    if (options.client) {
      clients.push(options.client.toLowerCase());
    } else {
      // Auto-detect installed clients
      if (existsSync(join(homedir(), ".codex"))) clients.push("codex");
      if (existsSync(join(homedir(), ".claude"))) clients.push("claude");
      if (existsSync(join(homedir(), ".cursor"))) clients.push("cursor");
      if (existsSync(join(homedir(), ".gemini"))) clients.push("gemini");
    }

    if (clients.length === 0) {
      console.log(chalk.dim("  No AI clients detected. Install manually: ") + chalk.cyan("asgcard install --client <client>"));
    } else {
      // NOTE: No STELLAR_PRIVATE_KEY in configs — MCP server reads from ~/.asgcard/wallet.json
      for (const client of clients) {
        switch (client) {
          case "codex": {
            const configPath = join(homedir(), ".codex", "config.toml");
            mkdirSync(dirname(configPath), { recursive: true });
            let existing = "";
            try { existing = readFileSync(configPath, "utf-8"); } catch { /* */ }
            if (existing.includes("[mcp_servers.asgcard]")) {
              console.log(chalk.green("  ✅ Codex: already configured"));
            } else {
              const tomlBlock = `\n[mcp_servers.asgcard]\ncommand = "npx"\nargs = ["-y", "@asgcard/mcp-server"]\n`;
              writeFileSync(configPath, existing + tomlBlock);
              console.log(chalk.green("  ✅ Codex: MCP configured"));
            }
            break;
          }
          case "claude": {
            const claudeConfigPath = join(homedir(), ".claude", "mcp.json");
            mkdirSync(dirname(claudeConfigPath), { recursive: true });
            let claudeConfig: Record<string, unknown> = {};
            try { claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf-8")); } catch { /* */ }
            const servers = (claudeConfig.mcpServers || {}) as Record<string, unknown>;
            if (servers.asgcard) {
              console.log(chalk.green("  ✅ Claude: already configured"));
            } else {
              servers.asgcard = {
                command: "npx",
                args: ["-y", "@asgcard/mcp-server"],
              };
              claudeConfig.mcpServers = servers;
              writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
              console.log(chalk.green("  ✅ Claude: MCP configured"));
            }
            break;
          }
          case "cursor": {
            const cursorConfigPath = join(homedir(), ".cursor", "mcp.json");
            mkdirSync(dirname(cursorConfigPath), { recursive: true });
            let cursorConfig: Record<string, unknown> = {};
            try { cursorConfig = JSON.parse(readFileSync(cursorConfigPath, "utf-8")); } catch { /* */ }
            const cServers = (cursorConfig.mcpServers || {}) as Record<string, unknown>;
            if (cServers.asgcard) {
              console.log(chalk.green("  ✅ Cursor: already configured"));
            } else {
              cServers.asgcard = {
                command: "npx",
                args: ["-y", "@asgcard/mcp-server"],
              };
              cursorConfig.mcpServers = cServers;
              writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2));
              console.log(chalk.green("  ✅ Cursor: MCP configured"));
            }
            break;
          }
          case "gemini": {
            const geminiConfigPath = join(homedir(), ".gemini", "settings.json");
            mkdirSync(dirname(geminiConfigPath), { recursive: true });
            let geminiConfig: Record<string, unknown> = {};
            try { geminiConfig = JSON.parse(readFileSync(geminiConfigPath, "utf-8")); } catch { /* */ }
            const gServers = (geminiConfig.mcpServers || {}) as Record<string, unknown>;
            if (gServers.asgcard) {
              console.log(chalk.green("  ✅ Gemini: already configured"));
            } else {
              gServers.asgcard = {
                command: "npx",
                args: ["-y", "@asgcard/mcp-server"],
              };
              geminiConfig.mcpServers = gServers;
              writeFileSync(geminiConfigPath, JSON.stringify(geminiConfig, null, 2));
              console.log(chalk.green("  ✅ Gemini: MCP configured"));
            }
            break;
          }
        }
      }
    }
    console.log();

    // ── Step 3/9: Stellar Wallet ──────────────────────────
    console.log(chalk.bold(`Step 3/${TOTAL_STEPS}: Stellar Wallet`));
    if (key) {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      console.log(chalk.green("  ✅ Wallet found: ") + chalk.cyan(kp.publicKey()));
    } else if (options.yes) {
      // Auto-create wallet
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.random();
      const wallet: WalletState = {
        publicKey: kp.publicKey(),
        secretKey: kp.secret(),
        createdAt: new Date().toISOString(),
      };
      saveWallet(wallet);
      const config = loadConfig();
      config.privateKey = kp.secret();
      saveConfig(config);
      key = kp.secret();
      console.log(chalk.green("  ✅ New wallet created: ") + chalk.cyan(kp.publicKey()));
      console.log(chalk.dim("     Secret saved to: ") + chalk.dim(WALLET_FILE));
    } else {
      // Interactive: ask to create or import
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          chalk.cyan("  No wallet found. Create a new one? (Y/n): "),
          (a) => {
            rl.close();
            resolve(a.trim().toLowerCase());
          }
        );
      });

      if (answer === "" || answer === "y" || answer === "yes") {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const kp = Keypair.random();
        const wallet: WalletState = {
          publicKey: kp.publicKey(),
          secretKey: kp.secret(),
          createdAt: new Date().toISOString(),
        };
        saveWallet(wallet);
        const config = loadConfig();
        config.privateKey = kp.secret();
        saveConfig(config);
        key = kp.secret();
        console.log(chalk.green("  ✅ Wallet created: ") + chalk.cyan(kp.publicKey()));
      } else {
        console.log(chalk.dim("  Skipped. Run ") + chalk.cyan("asgcard wallet import") + chalk.dim(" later."));
      }
    }
    console.log();

    // ── Step 4/9: API Registration ─────────────────────────
    console.log(chalk.bold(`Step 4/${TOTAL_STEPS}: API Registration`));
    let apiRegistered = false;
    let telegramLink: string | null = null;
    let apiStatus: string | null = null;
    let pendingXdr: string | null = null;

    if (key) {
      try {
        const client = new WalletClient({ baseUrl: getApiUrl(), privateKey: key });
        const data = await client.authenticatedRequest<{
          registered: boolean;
          status: string;
          telegramLink?: string;
          expiresAt?: string;
          pendingXdr?: string | null;
          message?: string;
        }>("POST", "/onboard/register", { clientType: clients[0] ?? "manual" });

        apiRegistered = data.registered;
        apiStatus = data.status;
        telegramLink = data.telegramLink ?? null;
        pendingXdr = data.pendingXdr ?? null;

        if (data.status === "active") {
          console.log(chalk.green("  ✅ Already registered and active"));
        } else if (data.telegramLink) {
          console.log(chalk.green("  ✅ Registered. TG link issued."));
        } else {
          console.log(chalk.green("  ✅ Registered. Status: ") + chalk.cyan(data.status));
        }
      } catch {
        console.log(chalk.yellow("  ⚠ API unavailable or onboarding not enabled. Skipping."));
        console.log(chalk.dim("     This step will auto-complete when ONBOARDING_ENABLED=true on the server."));
      }
    } else {
      console.log(chalk.dim("  Skipped (no wallet)"));
    }
    console.log();

    // ── Step 5/9: Telegram Identity ────────────────────────
    console.log(chalk.bold(`Step 5/${TOTAL_STEPS}: Telegram Identity`));
    if (apiStatus === "active") {
      console.log(chalk.green("  ✅ Telegram already linked"));
    } else if (telegramLink) {
      console.log(chalk.cyan("  🔗 Open this link in Telegram to connect your financial identity:\n"));
      console.log(chalk.bold(`     ${telegramLink}`));
      console.log(chalk.dim("\n     Link expires in 10 minutes. After clicking, return here."));

      if (!options.yes) {
        const readline = await import("node:readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>((resolve) => {
          rl.question(chalk.dim("\n     Press Enter when you've clicked the link... "), () => {
            rl.close();
            resolve();
          });
        });
      }
    } else if (apiStatus === "pending_sponsor" || apiStatus === "sponsoring") {
      console.log(chalk.green("  ✅ Telegram already connected"));
    } else if (!apiRegistered) {
      console.log(chalk.dim("  Skipped (API registration pending)"));
    } else {
      console.log(chalk.dim("  Skipped (status: " + (apiStatus ?? "unknown") + ")"));
    }
    console.log();

    // ── Step 6/9: Wallet Activation (Sponsorship) ──────────
    console.log(chalk.bold(`Step 6/${TOTAL_STEPS}: Wallet Activation (Sponsorship)`));
    if (apiStatus === "active") {
      console.log(chalk.green("  ✅ Wallet already activated on Stellar"));
    } else if (pendingXdr && key) {
      // Co-sign the sponsored transaction XDR
      console.log(chalk.yellow("  ⏳ Sponsorship XDR received. Co-signing..."));
      try {
        const { Keypair, TransactionBuilder, Networks } = await import("@stellar/stellar-sdk");
        const kp = Keypair.fromSecret(key);
        const tx = TransactionBuilder.fromXDR(pendingXdr, Networks.PUBLIC);
        tx.sign(kp);
        const signedXdr = tx.toXDR();

        // Submit signed XDR back to API
        const client = new WalletClient({ baseUrl: getApiUrl(), privateKey: key });
        const submitResult = await client.authenticatedRequest<{
          success: boolean;
          status?: string;
          error?: string;
        }>("POST", "/onboard/submit-sponsor", { signedXdr });

        if (submitResult.success) {
          apiStatus = submitResult.status ?? "active";
          console.log(chalk.green("  ✅ Wallet activated on Stellar!"));
        } else {
          console.log(chalk.yellow("  ⚠ Co-sign submitted but activation pending: " + (submitResult.error ?? "unknown")));
        }
      } catch (e) {
        console.log(chalk.yellow("  ⚠ Could not co-sign XDR: " + (e instanceof Error ? e.message : String(e))));
        console.log(chalk.dim("     Check progress with: ") + chalk.cyan("asgcard status"));
      }
    } else if (pendingXdr) {
      console.log(chalk.yellow("  ⏳ Sponsorship XDR ready but no wallet key to co-sign."));
    } else if (apiStatus === "pending_identity") {
      console.log(chalk.dim("  Waiting for Telegram identity binding (step 5)"));
      console.log(chalk.dim("  Sponsorship XDR will be built automatically after TG connection."));
    } else {
      console.log(chalk.dim("  Skipped (will activate after TG binding)"));
    }
    console.log();

    // ── Step 7/9: Fund Link ────────────────────────────────
    console.log(chalk.bold(`Step 7/${TOTAL_STEPS}: Fund Link`));
    if (key) {
      try {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const kp = Keypair.fromSecret(key);
        const params = new URLSearchParams({
          agentName: "AI Agent",
          toAddress: kp.publicKey(),
          toAmount: "50",
          toToken: "USDC",
        });
        const fundUrl = `https://fund.asgcard.dev/?${params.toString()}`;

        console.log(chalk.green("  ✅ Fund link generated:"));
        console.log(chalk.dim("     Share this with the wallet owner to fund the agent:\n"));
        console.log(chalk.cyan(`     ${fundUrl}`));
      } catch {
        console.log(chalk.yellow("  ⚠ Could not generate fund link"));
      }
    } else {
      console.log(chalk.dim("  Skipped (no wallet)"));
    }
    console.log();

    // ── Step 8/9: Balance Check ────────────────────────────
    console.log(chalk.bold(`Step 8/${TOTAL_STEPS}: Balance Check`));
    if (key) {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const balance = await getUsdcBalance(kp.publicKey());

      if (balance === -1) {
        console.log(chalk.yellow("  ⚠ Could not check balance (Horizon API error)"));
        console.log(chalk.dim("     Check manually: ") + chalk.cyan("asgcard wallet info"));
      } else if (balance >= MIN_CREATE_COST) {
        console.log(chalk.green("  ✅ Wallet funded!") + chalk.dim(` Balance: $${balance.toFixed(2)} USDC`));
      } else {
        console.log(chalk.yellow(`  ⚠ Balance: $${balance.toFixed(2)} USDC`) + chalk.dim(` (need $${MIN_CREATE_COST} for minimum card)`));
      }
    } else {
      console.log(chalk.dim("  Skipped (no wallet)"));
    }
    console.log();

    // ── Step 9/9: Summary & Next Steps ─────────────────────
    console.log(chalk.bold(`Step 9/${TOTAL_STEPS}: Summary & Next Steps`));
    if (key) {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const balance = await getUsdcBalance(kp.publicKey());

      const steps: string[] = [];
      if (!apiRegistered) steps.push("Enable ONBOARDING_ENABLED=true on server, then re-run onboard");
      if (apiStatus === "pending_identity") steps.push("Click the Telegram link (step 5) to connect identity");
      if (apiStatus === "pending_sponsor" || pendingXdr) steps.push("Co-sign sponsorship XDR via MCP or CLI");
      if (balance >= 0 && balance < MIN_CREATE_COST) steps.push("Fund your wallet with USDC (use the fund link from step 7)");
      if (balance >= MIN_CREATE_COST) steps.push("Create your first card: asgcard card:create -a 10 -n \"AI Agent\" -e you@email.com -p +1234567890");

      if (steps.length === 0 && apiStatus === "active" && balance >= MIN_CREATE_COST) {
        console.log(chalk.green("  🎉 Fully onboarded and funded! Ready to create cards."));
        console.log(chalk.dim("\n  Quick commands:"));
        console.log(chalk.cyan("     asgcard card:create -a 10 -n \"AI Agent\" -e you@email.com -p +1234567890"));
        console.log(chalk.cyan("     asgcard status"));
        console.log(chalk.cyan("     asgcard balance"));
      } else if (steps.length > 0) {
        console.log(chalk.yellow("  Next steps:\n"));
        steps.forEach((s, i) => {
          console.log(chalk.dim(`  ${i + 1}. `) + chalk.white(s));
        });
      } else {
        console.log(chalk.dim("  Check: ") + chalk.cyan("asgcard status") + chalk.dim(" or ") + chalk.cyan("asgcard doctor"));
      }
    } else {
      console.log(chalk.yellow("  ⚠ No wallet configured."));
      console.log(chalk.dim("     Run: ") + chalk.cyan("asgcard wallet create") + chalk.dim(" or ") + chalk.cyan("asgcard wallet import"));
    }
    console.log();

    // ── Telemetry beacon (fire-and-forget) ──────────────
    try {
      const apiUrl = getApiUrl();
      fetch(`${apiUrl}/telemetry/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: clients[0] ?? "manual",
          version: VERSION,
          os: process.platform,
        }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {}); // swallow — never block
    } catch {
      // fail-open
    }
  });

// ── doctor ──────────────────────────────────────────────────

program
  .command("doctor")
  .description("Diagnose your ASG Card setup — checks CLI, wallet, API, RPC, and balance")
  .action(async () => {
    console.log(chalk.bold("\n🩺 ASG Card Doctor\n"));

    let allGood = true;

    // 1. CLI version
    console.log(chalk.dim("  CLI Version:      ") + chalk.cyan(VERSION));

    // 2. Config directory
    const configExists = existsSync(CONFIG_DIR);
    console.log(
      chalk.dim("  Config Dir:       ") +
        (configExists ? chalk.green(`✅ ${CONFIG_DIR}`) : chalk.red(`❌ ${CONFIG_DIR} — run: asgcard wallet create`))
    );
    if (!configExists) allGood = false;

    // 3. Private key
    const key = resolveKey();
    if (key) {
      try {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const kp = Keypair.fromSecret(key);
        console.log(chalk.dim("  Wallet Key:       ") + chalk.green(`✅ ${kp.publicKey().slice(0, 8)}...${kp.publicKey().slice(-4)}`));
      } catch {
        console.log(chalk.dim("  Wallet Key:       ") + chalk.red("❌ Invalid key — run: asgcard wallet create"));
        allGood = false;
      }
    } else {
      console.log(chalk.dim("  Wallet Key:       ") + chalk.red("❌ Not configured — run: asgcard wallet create"));
      allGood = false;
    }

    // 4. API health
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json() as { version?: string };
        console.log(chalk.dim("  API Health:       ") + chalk.green(`✅ ${apiUrl} (v${data.version || "?"})`));
      } else {
        console.log(chalk.dim("  API Health:       ") + chalk.red(`❌ ${apiUrl} returned ${res.status}`));
        allGood = false;
      }
    } catch (error) {
      console.log(chalk.dim("  API Health:       ") + chalk.red(`❌ ${apiUrl} — unreachable`));
      allGood = false;
    }

    // 5. Stellar Horizon
    try {
      const res = await fetch(`${HORIZON_URL}/`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        console.log(chalk.dim("  Stellar Horizon:  ") + chalk.green(`✅ ${HORIZON_URL}`));
      } else {
        console.log(chalk.dim("  Stellar Horizon:  ") + chalk.red(`❌ ${HORIZON_URL} returned ${res.status}`));
        allGood = false;
      }
    } catch {
      console.log(chalk.dim("  Stellar Horizon:  ") + chalk.red(`❌ ${HORIZON_URL} — unreachable`));
      allGood = false;
    }

    // 6. Soroban RPC
    const rpcUrl = getRpcUrl() || "https://mainnet.sorobanrpc.com";
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as { result?: { status?: string } };
        const status = data.result?.status || "ok";
        console.log(chalk.dim("  Soroban RPC:      ") + chalk.green(`✅ ${rpcUrl} (${status})`));
      } else {
        console.log(chalk.dim("  Soroban RPC:      ") + chalk.red(`❌ ${rpcUrl} returned ${res.status}`));
        allGood = false;
      }
    } catch {
      console.log(chalk.dim("  Soroban RPC:      ") + chalk.red(`❌ ${rpcUrl} — unreachable`));
      allGood = false;
    }

    // 7. USDC Balance
    if (key) {
      try {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const kp = Keypair.fromSecret(key);
        const balance = await getUsdcBalance(kp.publicKey());
        if (balance === -1) {
          console.log(chalk.dim("  USDC Balance:     ") + chalk.yellow("⚠ Could not fetch"));
        } else if (balance >= MIN_CREATE_COST) {
          console.log(chalk.dim("  USDC Balance:     ") + chalk.green(`✅ $${balance.toFixed(2)}`));
        } else {
          console.log(chalk.dim("  USDC Balance:     ") + chalk.red(`❌ $${balance.toFixed(2)} (need $${MIN_CREATE_COST} for card creation)`));
          allGood = false;
        }
      } catch {
        console.log(chalk.dim("  USDC Balance:     ") + chalk.yellow("⚠ Could not check (invalid key?)"));
      }
    } else {
      console.log(chalk.dim("  USDC Balance:     ") + chalk.dim("— (no wallet)"));
    }

    // 8. Skill check
    const skillExists = existsSync(join(SKILL_DIR, "SKILL.md"));
    console.log(
      chalk.dim("  Agent Skill:      ") +
        (skillExists ? chalk.green(`✅ ${SKILL_DIR}`) : chalk.yellow("⚠ Not installed — run: asgcard onboard"))
    );

    // 9. MCP configs
    const codexHas = existsSync(join(homedir(), ".codex", "config.toml")) &&
      readFileSync(join(homedir(), ".codex", "config.toml"), "utf-8").includes("[mcp_servers.asgcard]");
    const claudeHas = (() => {
      try {
        const c = JSON.parse(readFileSync(join(homedir(), ".claude", "mcp.json"), "utf-8"));
        return !!(c.mcpServers?.asgcard);
      } catch { return false; }
    })();
    const cursorHas = (() => {
      try {
        const c = JSON.parse(readFileSync(join(homedir(), ".cursor", "mcp.json"), "utf-8"));
        return !!(c.mcpServers?.asgcard);
      } catch { return false; }
    })();

    const mcpParts: string[] = [];
    if (codexHas) mcpParts.push("Codex");
    if (claudeHas) mcpParts.push("Claude");
    if (cursorHas) mcpParts.push("Cursor");

    // 10. Gemini MCP check
    const geminiHas = (() => {
      try {
        const c = JSON.parse(readFileSync(join(homedir(), ".gemini", "settings.json"), "utf-8"));
        return !!(c.mcpServers?.asgcard);
      } catch { return false; }
    })();
    if (geminiHas) mcpParts.push("Gemini");

    if (mcpParts.length > 0) {
      console.log(chalk.dim("  MCP Configured:   ") + chalk.green(`✅ ${mcpParts.join(", ")}`));
    } else {
      console.log(chalk.dim("  MCP Configured:   ") + chalk.yellow("⚠ None — run: asgcard install --client <client>"));
    }

    // 11. Onboarding status (API check)
    if (key) {
      try {
        const client = new WalletClient({ baseUrl: apiUrl, privateKey: key });
        const data = await client.authenticatedRequest<{
          registered: boolean;
          status: string;
          telegram?: { linked: boolean };
          balance?: number | null;
        }>("GET", "/wallet/status");

        if (data.status === "active") {
          console.log(chalk.dim("  Onboard Status:   ") + chalk.green("✅ Active (fully onboarded)"));
        } else if (data.registered) {
          console.log(chalk.dim("  Onboard Status:   ") + chalk.yellow(`⚠ ${data.status} — run: asgcard onboard`));
        } else {
          console.log(chalk.dim("  Onboard Status:   ") + chalk.dim("— Not registered yet"));
        }

        if (data.telegram?.linked) {
          console.log(chalk.dim("  Telegram:         ") + chalk.green("✅ Linked"));
        } else if (data.registered) {
          console.log(chalk.dim("  Telegram:         ") + chalk.yellow("⚠ Not linked — run: asgcard onboard"));
        }
      } catch {
        console.log(chalk.dim("  Onboard Status:   ") + chalk.dim("— Unavailable (onboarding may not be enabled)"));
      }
    }

    console.log();
    if (allGood) {
      console.log(chalk.green("  ✅ All checks passed! You're ready to create cards.\n"));
    } else {
      console.log(chalk.yellow("  ⚠ Some checks failed. Fix the issues above and run ") + chalk.cyan("asgcard doctor") + chalk.yellow(" again.\n"));
    }
  });

// ═══════════════════════════════════════════════════════════
// WALLET STATUS COMMANDS (v0.4.1 — queries /wallet/* routes)
// ═══════════════════════════════════════════════════════════

program
  .command("status")
  .description("Show onboarding lifecycle status from the API")
  .action(async () => {
    const key = resolveKey();
    if (!key) {
      remediate("No wallet configured", "Cannot check status without a wallet", "asgcard wallet create");
      process.exit(1);
    }

    const spinner = ora("Fetching wallet status...").start();

    try {
      const client = new WalletClient({ baseUrl: getApiUrl(), privateKey: key });
      const data = await client.authenticatedRequest<{
        registered: boolean;
        status: string;
        registeredAt?: string;
        sponsoredAt?: string;
        clientType?: string;
        telegram?: { linked: boolean; userId?: number; linkedAt?: string };
        balance?: number | null;
        pendingXdr?: string | null;
        message?: string;
      }>("GET", "/wallet/status");

      spinner.stop();

      console.log(chalk.bold("\n📊 Wallet Status\n"));

      if (!data.registered) {
        console.log(chalk.yellow("  Not registered.") + chalk.dim(" Run: ") + chalk.cyan("asgcard onboard"));
        console.log();
        return;
      }

      const statusColors: Record<string, (s: string) => string> = {
        active: chalk.green,
        pending_identity: chalk.yellow,
        pending_sponsor: chalk.yellow,
        sponsoring: chalk.blue,
        failed: chalk.red,
      };
      const colorFn = statusColors[data.status] ?? chalk.dim;

      console.log(chalk.dim("  Status:       ") + colorFn(data.status));
      console.log(chalk.dim("  Registered:   ") + chalk.dim(data.registeredAt ?? "—"));
      if (data.sponsoredAt) {
        console.log(chalk.dim("  Sponsored:    ") + chalk.green(data.sponsoredAt));
      }
      if (data.clientType) {
        console.log(chalk.dim("  Client:       ") + chalk.dim(data.clientType));
      }

      // Telegram
      if (data.telegram?.linked) {
        console.log(chalk.dim("  Telegram:     ") + chalk.green(`✅ Linked (user ${data.telegram.userId})`));
      } else {
        console.log(chalk.dim("  Telegram:     ") + chalk.yellow("⚠ Not linked"));
      }

      // Balance
      if (data.balance !== null && data.balance !== undefined) {
        const bal = data.balance;
        console.log(chalk.dim("  USDC Balance: ") + (bal >= MIN_CREATE_COST ? chalk.green(`$${bal.toFixed(2)}`) : chalk.yellow(`$${bal.toFixed(2)}`)));
      }

      // Pending XDR
      if (data.pendingXdr) {
        console.log(chalk.dim("  Pending XDR:  ") + chalk.blue("Co-sign required"));
      }

      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Could not fetch status"));
      console.log(chalk.dim("  The API may be unavailable or onboarding may not be enabled."));
      console.log(chalk.dim("  Try: ") + chalk.cyan("asgcard wallet info") + chalk.dim(" (local check)"));
      console.log();
    }
  });

program
  .command("fund-link")
  .description("Generate a fund.asgcard.dev URL for your wallet")
  .option("-n, --name <name>", "Agent name for the funding page", "AI Agent")
  .option("-a, --amount <amount>", "Suggested USDC amount", "50")
  .action(async (options: { name: string; amount: string }) => {
    const key = resolveKey();
    if (!key) {
      remediate("No wallet configured", "Cannot generate fund link without a wallet", "asgcard wallet create");
      process.exit(1);
    }

    try {
      const client = new WalletClient({ baseUrl: getApiUrl(), privateKey: key });
      const data = await client.authenticatedRequest<{
        url: string;
        address: string;
        agentName: string;
        amount: number;
        token: string;
      }>("GET", `/wallet/fund-link?agentName=${encodeURIComponent(options.name)}&amount=${options.amount}`);

      console.log(chalk.bold("\n🔗 Fund Link\n"));
      console.log(chalk.dim("  Agent:   ") + chalk.cyan(data.agentName));
      console.log(chalk.dim("  Amount:  ") + chalk.green(`$${data.amount} ${data.token}`));
      console.log(chalk.dim("  Address: ") + chalk.dim(data.address));
      console.log();
      console.log(chalk.bold("  URL: ") + chalk.cyan(data.url));
      console.log();
    } catch {
      // Fallback: generate locally
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const params = new URLSearchParams({
        agentName: options.name,
        toAddress: kp.publicKey(),
        toAmount: options.amount,
        toToken: "USDC",
      });
      const url = `https://fund.asgcard.dev/?${params.toString()}`;

      console.log(chalk.bold("\n🔗 Fund Link") + chalk.dim(" (generated locally)\n"));
      console.log(chalk.dim("  Agent:   ") + chalk.cyan(options.name));
      console.log(chalk.dim("  Amount:  ") + chalk.green(`$${options.amount} USDC`));
      console.log(chalk.dim("  Address: ") + chalk.dim(kp.publicKey()));
      console.log();
      console.log(chalk.bold("  URL: ") + chalk.cyan(url));
      console.log();
    }
  });

// ── wallet-balance ──────────────────────────────────────────

program
  .command("wallet-balance")
  .alias("wb")
  .description("Show your Stellar wallet USDC balance")
  .action(async () => {
    const key = resolveKey();
    if (!key) {
      remediate("No wallet configured", "Cannot check balance", "asgcard wallet create");
      process.exit(1);
    }

    try {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const pubKey = kp.publicKey();

      // First try API
      try {
        const client = new WalletClient({ baseUrl: getApiUrl(), privateKey: key });
        const data = await client.authenticatedRequest<{
          balance: number;
          asset: string;
          address: string;
        }>("GET", "/wallet/balance");

        if (typeof data.balance === "number") {
          console.log(chalk.bold("\n💰 Wallet Balance\n"));
          console.log(chalk.dim("  Address: ") + chalk.cyan(pubKey));
          console.log(chalk.dim("  Balance: ") + chalk.green(`$${data.balance.toFixed(2)} ${data.asset}`));
          console.log();
          return;
        }
      } catch { /* fallback to Horizon */ }

      // Fallback: direct Horizon query
      const resp = await fetch(`https://horizon.stellar.org/accounts/${pubKey}`);
      if (!resp.ok) {
        if (resp.status === 404) {
          console.log(chalk.bold("\n💰 Wallet Balance\n"));
          console.log(chalk.dim("  Address: ") + chalk.cyan(pubKey));
          console.log(chalk.yellow("  Balance: $0.00 USDC") + chalk.dim(" (account not funded on Stellar)"));
          console.log(chalk.dim("  Fund your wallet: ") + chalk.cyan("asgcard fund-link"));
          console.log();
          return;
        }
        throw new Error(`Horizon error: ${resp.status}`);
      }

      const account = await resp.json() as { balances: Array<{ asset_code?: string; asset_issuer?: string; balance: string }> };
      const usdcIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
      const usdcBalance = account.balances.find(
        (b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer
      );

      console.log(chalk.bold("\n💰 Wallet Balance\n"));
      console.log(chalk.dim("  Address: ") + chalk.cyan(pubKey));
      console.log(chalk.dim("  Balance: ") + chalk.green(`$${parseFloat(usdcBalance?.balance ?? "0").toFixed(2)} USDC`));
      if (!usdcBalance) {
        console.log(chalk.dim("  No USDC trustline. Fund your wallet: ") + chalk.cyan("asgcard fund-link"));
      }
      console.log();
    } catch (e) {
      console.error(chalk.red("✖ ") + (e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════
// EXISTING CARD COMMANDS (preserved with better error handling)
// ═══════════════════════════════════════════════════════════

// ── login (legacy, kept for backward compatibility) ─────────

program
  .command("login")
  .description("Configure your Stellar private key for wallet authentication")
  .argument("[key]", "Stellar secret key (S...). Omit to enter interactively")
  .option("--api-url <url>", "Custom API URL")
  .option("--rpc-url <url>", "Custom Stellar RPC URL")
  .action(async (key?: string, options?: { apiUrl?: string; rpcUrl?: string }) => {
    let privateKey = key;

    if (!privateKey) {
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      privateKey = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan("Enter Stellar secret key (S...): "), (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
    }

    if (!privateKey?.startsWith("S")) {
      remediate(
        "Invalid key format",
        "Stellar secret keys start with 'S' and are 56 characters",
        "asgcard wallet create  (to generate a new keypair)"
      );
      process.exit(1);
    }

    const config: Config = {
      ...loadConfig(),
      privateKey,
      ...(options?.apiUrl && { apiUrl: options.apiUrl }),
      ...(options?.rpcUrl && { rpcUrl: options.rpcUrl }),
    };
    saveConfig(config);

    const { Keypair } = await import("@stellar/stellar-sdk");
    const kp = Keypair.fromSecret(privateKey);

    console.log(chalk.green("✅ Key saved to ~/.asgcard/config.json"));
    console.log(chalk.dim("   Wallet: ") + chalk.cyan(kp.publicKey()));
    console.log(chalk.dim("   API:    ") + chalk.cyan(config.apiUrl || "https://api.asgcard.dev"));
  });

// ── cards (list) ────────────────────────────────────────────

program
  .command("cards")
  .description("List all your virtual cards")
  .action(async () => {
    const key = requireKey();
    const spinner = ora("Fetching cards...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const result = await client.listCards();
      spinner.stop();

      if (!result.cards || result.cards.length === 0) {
        console.log(chalk.dim("No cards found. Create one with: asgcard card:create"));
        return;
      }

      console.log(chalk.bold(`\n📇 ${result.cards.length} card(s):\n`));
      for (const card of result.cards) {
        console.log(formatCard(card as unknown as Record<string, unknown>));
        console.log();
      }
    } catch (error) {
      spinner.fail();
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("401") || msg.includes("403")) {
        remediate("Authentication failed", "Your wallet signature was rejected by the API", "Check your key: asgcard doctor");
      } else if (msg.includes("fetch") || msg.includes("ECONNREFUSED")) {
        remediate("API unreachable", msg, "Check connectivity: asgcard health");
      } else {
        remediate("Failed to list cards", msg, "Run: asgcard doctor");
      }
      process.exit(1);
    }
  });

// ── card (get) ──────────────────────────────────────────────

program
  .command("card")
  .description("Get summary for a specific card")
  .argument("<id>", "Card ID")
  .action(async (id: string) => {
    const key = requireKey();
    const spinner = ora("Fetching card...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const result = await client.getCard(id);
      spinner.stop();
      console.log(formatCard(result as unknown as Record<string, unknown>));
    } catch (error) {
      spinner.fail();
      remediate("Failed to fetch card", error instanceof Error ? error.message : String(error), "asgcard doctor");
      process.exit(1);
    }
  });

// ── card:details ────────────────────────────────────────────

program
  .command("card:details")
  .description("Get sensitive card details (PAN, CVV, expiry)")
  .argument("<id>", "Card ID")
  .action(async (id: string) => {
    const key = requireKey();
    const spinner = ora("Fetching card details...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const result = await client.getCardDetails(id);
      spinner.stop();

      console.log(chalk.bold("\n🔒 Sensitive Card Details:\n"));
      const details = result as unknown as Record<string, unknown>;
      console.log(`  Card Number:  ${chalk.cyan(String(details.cardNumber || ""))}`);
      console.log(`  CVV:          ${chalk.cyan(String(details.cvv || ""))}`);
      console.log(`  Expiry:       ${chalk.cyan(`${details.expiryMonth}/${details.expiryYear}`)}`);

      const addr = details.billingAddress as Record<string, unknown> | undefined;
      if (addr) {
        console.log(`  Address:      ${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}, ${addr.country}`);
      }
      console.log(chalk.dim("\n  ⚠ Store securely. Rate-limited to 5/hour."));
    } catch (error) {
      spinner.fail();
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("429")) {
        remediate("Rate limited", "Card details access is limited to 5 times per hour", "Wait and try again later");
      } else {
        remediate("Failed to fetch details", msg, "asgcard doctor");
      }
      process.exit(1);
    }
  });

// ── card:create ─────────────────────────────────────────────

const AMOUNT_MIN = 5;
const AMOUNT_MAX = 5000;

function isValidAmount(amount: string): boolean {
  const num = Number(amount);
  if (num === 0) return true; // card-only, $10 flat
  return Number.isFinite(num) && num >= AMOUNT_MIN && num <= AMOUNT_MAX;
}

program
  .command("card:create")
  .description("Create a new virtual card (pays on-chain via x402)")
  .requiredOption("-a, --amount <amount>", `Card load amount (0 = card-only, or $${AMOUNT_MIN}–$${AMOUNT_MAX})`)
  .requiredOption("-n, --name <name>", "Name on card")
  .requiredOption("-e, --email <email>", "Email for notifications")
  .requiredOption("-p, --phone <phone>", "Phone number (e.g. +1234567890)")
  .action(async (options: { amount: string; name: string; email: string; phone: string }) => {
    if (!isValidAmount(options.amount)) {
      remediate(
        `Invalid amount: ${options.amount}`,
        `Amount must be 0 (card-only) or between $${AMOUNT_MIN} and $${AMOUNT_MAX}`,
        "asgcard pricing  (to see pricing details)"
      );
      process.exit(1);
    }

    const key = requireKey();

    // Pre-flight balance check
    try {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const balance = await getUsdcBalance(kp.publicKey());
      if (balance === 0) {
        console.error(
          chalk.red("❌ Wallet has zero USDC balance\n") +
            chalk.dim("   You need USDC on Stellar to pay for card creation.\n\n") +
            chalk.bold("   Option 1 (Stellar):  ") + chalk.cyan(`Send USDC to ${kp.publicKey()}`) + "\n" +
            chalk.dim("                        Then: ") + chalk.cyan("asgcard wallet info\n\n") +
            chalk.bold("   Option 2 (Stripe):   ") + chalk.cyan("asgcard stripe:session <your-email>") + "\n" +
            chalk.dim("                        Then: ") + chalk.cyan(`asgcard stripe:request -a ${options.amount} -n "${options.name}" -p +1234567890`) + "\n"
        );
        process.exit(1);
      }
    } catch {
      // Non-critical pre-flight — continue and let SDK handle it
    }

    const spinner = ora(`Creating $${options.amount} card...`).start();

    try {
      const client = new ASGCardClient({
        privateKey: key,
        baseUrl: getApiUrl(),
        rpcUrl: getRpcUrl(),
      });

      const result = await client.createCard({
        amount: Number(options.amount),
        nameOnCard: options.name,
        email: options.email,
        phone: options.phone,
      });

      spinner.succeed(chalk.green("Card created!"));
      console.log(formatCard(result.card as unknown as Record<string, unknown>));

      if (result.detailsEnvelope) {
        console.log(chalk.bold("\n🔒 Card Details (one-time):"));
        console.log(`  Number: ${chalk.cyan(result.detailsEnvelope.cardNumber)}`);
        console.log(`  CVV:    ${chalk.cyan(result.detailsEnvelope.cvv)}`);
        console.log(`  Expiry: ${chalk.cyan(`${result.detailsEnvelope.expiryMonth}/${result.detailsEnvelope.expiryYear}`)}`);
      }

      console.log(chalk.dim(`\n  TX: ${result.payment.txHash}`));
    } catch (error) {
      spinner.fail();
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Insufficient") || msg.includes("balance")) {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const kp = Keypair.fromSecret(key);
        console.error(
          chalk.red("❌ Insufficient USDC balance\n") +
            chalk.dim(`   ${msg}\n\n`) +
            chalk.bold("   Option 1 (Stellar):  ") + chalk.cyan(`Deposit USDC to ${kp.publicKey()}`) + "\n" +
            chalk.dim(`                        Then: asgcard card:create -a ${options.amount} -n "${options.name}" -e ${options.email} -p ${options.phone}\n\n`) +
            chalk.bold("   Option 2 (Stripe):   ") + chalk.cyan("asgcard stripe:session <your-email>") + "\n" +
            chalk.dim(`                        Then: asgcard stripe:request -a ${options.amount} -n "${options.name}" -p +1234567890`) + "\n"
        );
      } else if (msg.includes("simulation")) {
        remediate("Transaction simulation failed", msg, "Check: asgcard doctor  (RPC connectivity + balance)");
      } else {
        remediate("Card creation failed", msg, "asgcard doctor");
      }
      process.exit(1);
    }
  });

// ── card:fund ───────────────────────────────────────────────

program
  .command("card:fund")
  .description("Fund an existing card (pays on-chain via x402)")
  .argument("<id>", "Card ID to fund")
  .requiredOption("-a, --amount <amount>", `Fund amount ($${AMOUNT_MIN}–$${AMOUNT_MAX})`)
  .action(async (id: string, options: { amount: string }) => {
    if (!isValidAmount(options.amount)) {
      remediate(
        `Invalid amount: ${options.amount}`,
        `Amount must be between $${AMOUNT_MIN} and $${AMOUNT_MAX}`,
        "asgcard pricing  (to see pricing details)"
      );
      process.exit(1);
    }

    const key = requireKey();
    const spinner = ora(`Funding $${options.amount}...`).start();

    try {
      const client = new ASGCardClient({
        privateKey: key,
        baseUrl: getApiUrl(),
        rpcUrl: getRpcUrl(),
      });

      const result = await client.fundCard({
        amount: Number(options.amount),
        cardId: id,
      });

      spinner.succeed(chalk.green(`Funded $${result.fundedAmount}!`));
      console.log(`  Card:        ${result.cardId}`);
      console.log(`  New balance: ${chalk.green("$" + result.newBalance)}`);
      console.log(chalk.dim(`  TX: ${result.payment.txHash}`));
    } catch (error) {
      spinner.fail();
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Insufficient") || msg.includes("balance")) {
        remediate("Insufficient USDC balance", msg, "asgcard wallet info  (check balance and deposit)");
      } else {
        remediate("Funding failed", msg, "asgcard doctor");
      }
      process.exit(1);
    }
  });

// ── card:freeze / card:unfreeze ─────────────────────────────

program
  .command("card:freeze")
  .description("Temporarily freeze a card")
  .argument("<id>", "Card ID")
  .action(async (id: string) => {
    const key = requireKey();
    const spinner = ora("Freezing card...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      await client.freezeCard(id);
      spinner.succeed(chalk.blue(`❄ Card ${id} frozen`));
    } catch (error) {
      spinner.fail();
      remediate("Failed to freeze card", error instanceof Error ? error.message : String(error), "asgcard doctor");
      process.exit(1);
    }
  });

program
  .command("card:unfreeze")
  .description("Unfreeze a frozen card")
  .argument("<id>", "Card ID")
  .action(async (id: string) => {
    const key = requireKey();
    const spinner = ora("Unfreezing card...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      await client.unfreezeCard(id);
      spinner.succeed(chalk.green(`🔓 Card ${id} unfrozen`));
    } catch (error) {
      spinner.fail();
      remediate("Failed to unfreeze card", error instanceof Error ? error.message : String(error), "asgcard doctor");
      process.exit(1);
    }
  });

// ── transactions ─────────────────────────────────────────────

program
  .command("transactions")
  .description("View transaction history for a card (real 4payments data)")
  .argument("<id>", "Card ID")
  .option("--page <page>", "Page number", "1")
  .option("--limit <limit>", "Results per page (max 100)", "20")
  .action(async (id: string, opts: { page: string; limit: string }) => {
    const key = requireKey();
    const spinner = ora("Fetching transactions...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const result = await client.getTransactions(id, parseInt(opts.page), Math.min(parseInt(opts.limit), 100));
      spinner.stop();

      console.log(chalk.bold(`\n📜 Transactions for ${chalk.cyan(result.cardId)}${result.lastFour ? ` (**** ${result.lastFour})` : ""}:\n`));

      if (result.transactions.length === 0) {
        console.log(chalk.dim("  No transactions yet. Use the card to see activity here."));
      } else {
        console.log(chalk.dim("  Type          Amount      Status      Merchant / Description         Date"));
        console.log(chalk.dim("  " + "─".repeat(85)));
        for (const tx of result.transactions) {
          const amount = tx.amount < 0 ? chalk.red(`-$${Math.abs(tx.amount).toFixed(2)}`) : chalk.green(`+$${tx.amount.toFixed(2)}`);
          const desc = tx.merchantName || tx.description || "—";
          const date = new Date(tx.createdAt).toLocaleDateString();
          console.log(`  ${tx.type.padEnd(14)} ${amount.padEnd(20)} ${tx.status.padEnd(12)} ${desc.substring(0, 30).padEnd(30)} ${chalk.dim(date)}`);
        }
      }

      if (result.pagination.pages > 1) {
        console.log(chalk.dim(`\n  Page ${result.pagination.page}/${result.pagination.pages} (${result.pagination.total} total) — use --page N`));
      }
    } catch (error) {
      spinner.fail();
      remediate("Failed to fetch transactions", error instanceof Error ? error.message : String(error), "asgcard doctor");
      process.exit(1);
    }
  });

// ── balance ──────────────────────────────────────────────────

program
  .command("balance")
  .description("Get live card balance from 4payments")
  .argument("<id>", "Card ID")
  .action(async (id: string) => {
    const key = requireKey();
    const spinner = ora("Fetching balance...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const result = await client.getBalance(id);
      spinner.stop();

      console.log(chalk.bold(`\n💳 Balance: ${chalk.green("$" + result.balance.toFixed(2))} ${result.currency}`));
      console.log(chalk.dim(`   Card:   ${result.cardId}${result.lastFour ? ` (**** ${result.lastFour})` : ""}`));
      if (result.status) console.log(chalk.dim(`   Status: ${result.status}`));
      console.log(chalk.dim(`   Source: ${result.source}`));
    } catch (error) {
      spinner.fail();
      remediate("Failed to fetch balance", error instanceof Error ? error.message : String(error), "asgcard doctor");
      process.exit(1);
    }
  });

// ── history ──────────────────────────────────────────────────

program
  .command("history")
  .description("Show all cards with live balances for your wallet")
  .action(async () => {
    const key = requireKey();
    const spinner = ora("Fetching wallet history...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const { cards } = await client.listCards();
      spinner.stop();

      if (!cards || cards.length === 0) {
        console.log(chalk.dim("No cards found. Create one with: asgcard card:create"));
        return;
      }

      console.log(chalk.bold(`\n📊 Wallet History — ${cards.length} card(s):\n`));
      console.log(chalk.dim("  Card ID              Last 4    Balance     Status      Created"));
      console.log(chalk.dim("  " + "─".repeat(75)));

      let totalBalance = 0;
      for (const card of cards) {
        const c = card as unknown as Record<string, unknown>;
        const balance = Number(c.balance || 0);
        totalBalance += balance;
        const lastFour = String(c.lastFour || "????");
        const status = String(c.status || "unknown");
        const created = c.createdAt ? new Date(String(c.createdAt)).toLocaleDateString() : "—";
        const statusColor = status === "active" ? chalk.green(status) : chalk.red(status);
        console.log(`  ${chalk.cyan(String(c.cardId).padEnd(22))} ${lastFour.padEnd(10)} ${chalk.green("$" + balance.toFixed(2)).padEnd(20)} ${statusColor.padEnd(20)} ${chalk.dim(created)}`);
      }

      console.log(chalk.dim("  " + "─".repeat(75)));
      console.log(`  ${chalk.bold("Total:")} ${chalk.green("$" + totalBalance.toFixed(2))}`);
      console.log();
    } catch (error) {
      spinner.fail();
      remediate("Failed to fetch history", error instanceof Error ? error.message : String(error), "asgcard doctor");
      process.exit(1);
    }
  });

// ── pricing (no private key required) ───────────────────────

program
  .command("pricing")
  .description("View current pricing (no authentication required)")
  .action(async () => {
    const spinner = ora("Fetching pricing...").start();

    try {
      const res = await fetch(`${getApiUrl()}/pricing`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json() as { cardFee?: number; topUpPercent?: number; minAmount?: number; maxAmount?: number };
      spinner.stop();

      const cardFee = data.cardFee ?? 10;
      const topUpPct = data.topUpPercent ?? 3.5;
      const minAmt = data.minAmount ?? 5;
      const maxAmt = data.maxAmount ?? 5000;

      console.log(chalk.bold("\n💳 ASG Card Pricing\n"));
      console.log(chalk.dim("  Card Issuance:  ") + chalk.green(`$${cardFee}`) + chalk.dim(" (one-time)"));
      console.log(chalk.dim("  Top-Up Fee:     ") + chalk.green(`${topUpPct}%`) + chalk.dim(" (on every load)"));
      console.log(chalk.dim("  Amount Range:   ") + chalk.dim(`$${minAmt} – $${maxAmt} per operation`));

      const round2 = (n: number) => Math.round(n * 100) / 100;
      const sampleAmounts = [25, 50, 100, 250, 500, 1000];

      console.log(chalk.bold("\n  Card Creation Examples:\n"));
      console.log(chalk.dim("  Load        + Card Fee   + Top-Up       = Total USDC"));
      for (const amt of sampleAmounts) {
        const topUp = round2(amt * topUpPct / 100);
        const total = round2(amt + cardFee + topUp);
        console.log(
          `  ${chalk.green("$" + String(amt).padEnd(9))} ` +
          `${chalk.dim("$" + String(cardFee).padEnd(10))} ` +
          `${chalk.dim("$" + topUp.toFixed(2).padEnd(12))} ` +
          `${chalk.cyan("$" + total.toFixed(2))}`
        );
      }

      console.log(chalk.bold("\n  Card Funding Examples:\n"));
      console.log(chalk.dim("  Amount      + Top-Up       = Total USDC"));
      for (const amt of sampleAmounts) {
        const topUp = round2(amt * topUpPct / 100);
        const total = round2(amt + topUp);
        console.log(
          `  ${chalk.green("$" + String(amt).padEnd(9))} ` +
          `${chalk.dim("$" + topUp.toFixed(2).padEnd(12))} ` +
          `${chalk.cyan("$" + total.toFixed(2))}`
        );
      }

      console.log(chalk.dim("\n  Any amount $" + minAmt + "–$" + maxAmt + " is supported."));
      console.log(chalk.dim("  Endpoints: POST /cards/create/tier/:amount • POST /cards/fund/tier/:amount\n"));
    } catch (error) {
      spinner.fail();
      remediate(
        "Failed to fetch pricing",
        error instanceof Error ? error.message : String(error),
        "Check API status: asgcard health"
      );
      process.exit(1);
    }
  });

// ── health ──────────────────────────────────────────────────

program
  .command("health")
  .description("Check API health (no authentication required)")
  .action(async () => {
    const spinner = ora("Checking API...").start();

    try {
      const res = await fetch(`${getApiUrl()}/health`);
      const data = await res.json() as Record<string, unknown>;
      spinner.succeed(
        chalk.green("API is healthy ") +
          chalk.dim(`v${data.version} — ${data.timestamp}`)
      );
    } catch (error) {
      spinner.fail();
      remediate(
        "API unreachable",
        error instanceof Error ? error.message : String(error),
        "Check your internet connection and try again"
      );
      process.exit(1);
    }
  });

// ── whoami ──────────────────────────────────────────────────

program
  .command("whoami")
  .description("Show your configured wallet address")
  .action(async () => {
    const key = resolveKey();
    if (!key) {
      remediate("No wallet configured", "No key in config, wallet file, or environment", "asgcard wallet create");
      process.exit(1);
    }
    const { Keypair } = await import("@stellar/stellar-sdk");
    const kp = Keypair.fromSecret(key);
    console.log(chalk.cyan(kp.publicKey()));
  });

// ═══════════════════════════════════════════════════════════
// TELEGRAM COMMANDS
// ═══════════════════════════════════════════════════════════

// ── telegram:link ───────────────────────────────────────────

program
  .command("telegram:link")
  .description("Generate a Telegram deep-link to connect notifications for this wallet")
  .action(async () => {
    const key = requireKey();
    const spinner = ora("Generating Telegram link...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const result = await client.getTelegramLinkToken();
      spinner.stop();

      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const walletShort = kp.publicKey().slice(0, 6) + "..." + kp.publicKey().slice(-4);

      console.log(chalk.green("\n✅ Telegram link generated!\n"));
      console.log(chalk.bold("   Open this link in Telegram:\n"));
      console.log(chalk.cyan(`   ${result.deepLink}\n`));
      console.log(chalk.dim("   ⏱ Expires: ") + chalk.yellow(new Date(result.expiresAt).toLocaleTimeString()));
      console.log();
      console.log(chalk.dim("   Send this link to the card owner."));
      console.log(chalk.dim("   When they click it, the bot will bind their Telegram"));
      console.log(chalk.dim("   to wallet ") + chalk.cyan(walletShort) + chalk.dim(" for transaction notifications."));
      console.log();
    } catch (error) {
      spinner.fail();
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404")) {
        remediate(
          "Telegram linking not available",
          "The Owner Portal feature is not enabled on this API server",
          "Contact the platform administrator or check https://docs.asgcard.dev/telegram"
        );
      } else if (msg.includes("401") || msg.includes("403")) {
        remediate("Authentication failed", "Wallet signature rejected", "Check your key: asgcard doctor");
      } else {
        remediate("Failed to generate link", msg, "asgcard doctor");
      }
      process.exit(1);
    }
  });

// ── telegram:status ─────────────────────────────────────────

program
  .command("telegram:status")
  .description("Check Telegram connection status for this wallet")
  .action(async () => {
    const key = requireKey();
    const spinner = ora("Checking Telegram status...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const result = await client.getTelegramStatus();
      spinner.stop();

      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const walletShort = kp.publicKey().slice(0, 6) + "..." + kp.publicKey().slice(-4);

      console.log(chalk.bold("\n📱 Telegram Status\n"));
      console.log(chalk.dim("   Wallet:  ") + chalk.cyan(walletShort));

      if (result.linked) {
        const linkedDate = result.linkedAt
          ? new Date(result.linkedAt).toLocaleDateString()
          : "unknown date";
        console.log(chalk.dim("   Status:  ") + chalk.green(`✅ Connected (since ${linkedDate})`));
        console.log();
        console.log(chalk.dim("   You will receive transaction notifications."));
        console.log(chalk.dim("   To disconnect: ") + chalk.cyan("asgcard telegram:revoke"));
      } else {
        console.log(chalk.dim("   Status:  ") + chalk.red("❌ Not connected"));
        console.log();
        console.log(chalk.dim("   To connect: ") + chalk.cyan("asgcard telegram:link"));
      }
      console.log();
    } catch (error) {
      spinner.fail();
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404")) {
        remediate(
          "Telegram status not available",
          "The Owner Portal feature is not enabled on this API server",
          "Contact the platform administrator or check https://docs.asgcard.dev/telegram"
        );
      } else {
        remediate("Failed to check status", msg, "asgcard doctor");
      }
      process.exit(1);
    }
  });

// ── telegram:revoke ─────────────────────────────────────────

program
  .command("telegram:revoke")
  .description("Disconnect Telegram from this wallet — stops all notifications")
  .action(async () => {
    const key = requireKey();
    const spinner = ora("Revoking Telegram connection...").start();

    try {
      const client = new WalletClient({ privateKey: key, baseUrl: getApiUrl() });
      const result = await client.revokeTelegram();
      spinner.stop();

      if (result.revoked) {
        console.log(chalk.green("\n✅ Telegram disconnected. Bot access revoked.\n"));
        console.log(chalk.dim("   Transaction notifications stopped immediately."));
        console.log(chalk.dim("   To reconnect: ") + chalk.cyan("asgcard telegram:link"));
      } else {
        console.log(chalk.yellow("\n⚠ No active Telegram connection found.\n"));
        console.log(chalk.dim("   To connect: ") + chalk.cyan("asgcard telegram:link"));
      }
      console.log();
    } catch (error) {
      spinner.fail();
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404")) {
        remediate(
          "Telegram revoke not available",
          "The Owner Portal feature is not enabled on this API server",
          "Contact the platform administrator or check https://docs.asgcard.dev/telegram"
        );
      } else {
        remediate("Failed to revoke", msg, "asgcard doctor");
      }
      process.exit(1);
    }
  });

// ── stripe:session ───────────────────────────────────────────

program
  .command("stripe:session")
  .description("Create or view a Stripe MPP session (fallback rail)")
  .argument("[email]", "Owner email — creates a new session")
  .option("--clear", "Clear saved session")
  .action(async (email: string | undefined, options: { clear?: boolean }) => {
    if (options.clear) {
      clearStripeSession();
      console.log(chalk.green("✅ Stripe session cleared."));
      return;
    }

    if (!email) {
      const session = loadStripeSession();
      if (!session) {
        console.log(chalk.dim("No Stripe session saved.") + "\n" + chalk.cyan("  Create one: asgcard stripe:session <email>"));
      } else {
        console.log(chalk.bold("\n🔗 Stripe Session"));
        console.log(`  Session ID: ${chalk.cyan(session.sessionId)}`);
        console.log(`  Owner ID:   ${chalk.cyan(session.ownerId)}`);
        console.log(`  Email:      ${chalk.dim(session.email)}`);
        console.log(`  Wallet:     ${chalk.dim(session.managedWalletAddress)}`);
        console.log(`  Created:    ${chalk.dim(session.createdAt)}`);
        console.log(chalk.dim("\n  To clear: asgcard stripe:session --clear"));
      }
      return;
    }

    const spinner = ora("Creating Stripe session...").start();

    try {
      const res = await fetch(`${getApiUrl()}/stripe-beta/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        spinner.fail();
        remediate(
          "Session creation failed",
          String(data.error || res.statusText),
          "Check your email is enrolled in the Stripe beta"
        );
        process.exit(1);
      }

      const session: StripeSessionState = {
        sessionId: String(data.sessionId),
        ownerId: String(data.ownerId),
        sessionKey: String(data.sessionKey),
        managedWalletAddress: String(data.managedWalletAddress),
        email,
        createdAt: new Date().toISOString(),
      };
      saveStripeSession(session);

      spinner.succeed(chalk.green("Stripe session created!"));
      console.log(`  Session ID: ${chalk.cyan(session.sessionId)}`);
      console.log(`  Owner ID:   ${chalk.cyan(session.ownerId)}`);
      console.log(`  Wallet:     ${chalk.dim(session.managedWalletAddress)}`);
      console.log(chalk.yellow("\n  ⚠ Session key saved to ~/.asgcard/stripe-session.json"));
      console.log(chalk.dim("\n  Next: asgcard stripe:request -a <amount> -n \"Card Name\" -p +1234567890"));
    } catch (error) {
      spinner.fail();
      remediate("Session creation failed", error instanceof Error ? error.message : String(error), "Check your internet connection");
      process.exit(1);
    }
  });

// ── stripe:request ──────────────────────────────────────────

program
  .command("stripe:request")
  .description("Create a Stripe payment request (card creation via Stripe fallback)")
  .requiredOption("-a, --amount <amount>", "Card load amount (0 = card-only $10, or $5–$5,000)")
  .requiredOption("-n, --name <name>", "Name on card")
  .requiredOption("-e, --email <email>", "User's email address")
  .requiredOption("-p, --phone <phone>", "Phone number (e.g. +1234567890)")
  .option("-d, --description <desc>", "Description for the request")
  .action(async (options: { amount: string; name: string; email: string; phone: string; description?: string }) => {
    const amount = Number(options.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 5000) {
      remediate("Invalid amount", "Amount must be 0 (card-only) or $5–$5,000", "asgcard pricing");
      process.exit(1);
    }
    if (amount > 0 && amount < 5) {
      remediate("Amount too low", "Minimum load is $5 (or use 0 for card-only)", "asgcard pricing");
      process.exit(1);
    }

    const session = requireStripeSession();
    const spinner = ora("Creating payment request...").start();

    try {
      const res = await fetch(`${getApiUrl()}/stripe-beta/payment-requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-STRIPE-SESSION": session.sessionKey,
        },
        body: JSON.stringify({
          amountUsd: amount,
          nameOnCard: options.name,
          email: options.email,
          phone: options.phone,
          description: options.description,
        }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        spinner.fail();
        remediate(
          "Payment request failed",
          String(data.error || res.statusText),
          "Check your session: asgcard stripe:session"
        );
        process.exit(1);
      }

      const fee = amount === 0 ? CARD_FEE : CARD_FEE + amount + amount * TOPUP_RATE;
      spinner.succeed(chalk.green("Payment request created!"));
      console.log(`  Request ID:  ${chalk.cyan(String(data.requestId))}`);
      console.log(`  Amount:      ${chalk.green(`$${amount}`)} ${amount === 0 ? "(card-only)" : "+ $10 fee + 3.5%"}`);
      console.log(`  Total:       ${chalk.bold(`$${fee.toFixed(2)}`)}`);
      console.log(`  Expires:     ${chalk.dim(String(data.expiresAt))}`);
      console.log(chalk.yellow(`\n  📧 Send this approval URL to the card owner:`));
      console.log(`     ${chalk.cyan(String(data.approvalUrl))}\n`);
      console.log(chalk.dim(`  Then wait: asgcard stripe:wait ${data.requestId}`));
    } catch (error) {
      spinner.fail();
      remediate("Payment request failed", error instanceof Error ? error.message : String(error), "asgcard stripe:session");
      process.exit(1);
    }
  });

// ── stripe:status ───────────────────────────────────────────

program
  .command("stripe:status")
  .description("Check status of a Stripe payment request")
  .argument("<id>", "Payment request ID")
  .action(async (id: string) => {
    const session = requireStripeSession();
    const spinner = ora("Checking payment request...").start();

    try {
      const res = await fetch(`${getApiUrl()}/stripe-beta/payment-requests/${id}`, {
        headers: { "X-STRIPE-SESSION": session.sessionKey },
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        spinner.fail();
        remediate(
          "Status check failed",
          String(data.error || res.statusText),
          "Check request ID and session: asgcard stripe:session"
        );
        process.exit(1);
      }

      spinner.stop();
      const status = String(data.status);
      const statusColor =
        status === "completed" ? chalk.green :
        status === "pending" ? chalk.yellow :
        status === "approved" ? chalk.blue :
        chalk.red;

      console.log(chalk.bold(`\n📋 Payment Request ${chalk.cyan(id)}`));
      console.log(`  Status:      ${statusColor(status)}`);
      console.log(`  Amount:      ${chalk.green(`$${data.amountUsd}`)}`);
      if (data.description) console.log(`  Description: ${chalk.dim(String(data.description))}`);
      if (data.cardId) console.log(`  Card ID:     ${chalk.cyan(String(data.cardId))}`);
      if (data.createdAt) console.log(`  Created:     ${chalk.dim(String(data.createdAt))}`);

      if (status === "pending") {
        console.log(chalk.dim("\n  Waiting for owner approval..."));
        console.log(chalk.dim(`  Wait: asgcard stripe:wait ${id}`));
      }
    } catch (error) {
      spinner.fail();
      remediate("Status check failed", error instanceof Error ? error.message : String(error), "asgcard stripe:session");
      process.exit(1);
    }
  });

// ── stripe:wait ─────────────────────────────────────────────

program
  .command("stripe:wait")
  .description("Wait for a Stripe payment request to complete (polls until terminal state)")
  .argument("<id>", "Payment request ID")
  .option("-t, --timeout <seconds>", "Timeout in seconds", "300")
  .action(async (id: string, options: { timeout: string }) => {
    const session = requireStripeSession();
    const timeoutMs = Number(options.timeout) * 1000;
    const startTime = Date.now();
    const pollInterval = 3000;

    const spinner = ora(`Waiting for payment request ${chalk.cyan(id)}...`).start();
    spinner.text = `Waiting for owner approval... ${chalk.dim(`(timeout: ${options.timeout}s)`)}`;

    const terminalStatuses = new Set(["completed", "rejected", "expired", "failed"]);

    try {
      while (Date.now() - startTime < timeoutMs) {
        const res = await fetch(`${getApiUrl()}/stripe-beta/payment-requests/${id}`, {
          headers: { "X-STRIPE-SESSION": session.sessionKey },
        });

        if (!res.ok) {
          spinner.fail();
          const data = await res.json() as Record<string, unknown>;
          remediate("Poll failed", String(data.error || res.statusText), "asgcard stripe:session");
          process.exit(1);
        }

        const data = await res.json() as Record<string, unknown>;
        const status = String(data.status);

        if (status === "completed") {
          spinner.succeed(chalk.green("Payment completed — card created!"));
          if (data.cardId) {
            console.log(`  Card ID: ${chalk.cyan(String(data.cardId))}`);
            console.log(chalk.dim("\n  View cards: asgcard stripe:cards  (coming soon)"));
          }
          process.exit(0);
        }

        if (terminalStatuses.has(status)) {
          spinner.fail(chalk.red(`Payment request ${status}`));
          if (status === "rejected") console.log(chalk.dim("  The owner rejected this payment request."));
          if (status === "expired") console.log(chalk.dim("  The request expired (1 hour TTL)."));
          if (status === "failed") console.log(chalk.dim("  Payment or card creation failed."));
          process.exit(1);
        }

        // Still pending or approved — keep polling
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        spinner.text = `Waiting for owner approval... ${chalk.dim(`(${elapsed}s / ${options.timeout}s)`)}`;
        if (status === "approved") {
          spinner.text = `Owner approved — processing payment... ${chalk.dim(`(${elapsed}s)`)}`;
        }

        await new Promise((r) => setTimeout(r, pollInterval));
      }

      spinner.fail(chalk.red("Timeout — owner did not respond"));
      console.log(chalk.dim(`  Request ${id} is still pending.`));
      console.log(chalk.dim(`  Check again: asgcard stripe:status ${id}`));
      process.exit(1);
    } catch (error) {
      spinner.fail();
      remediate("Wait failed", error instanceof Error ? error.message : String(error), "asgcard stripe:session");
      process.exit(1);
    }
  });

// ── Default action: no subcommand → onboard -y ─────────────
// If the user runs `npx @asgcard/cli` without any subcommand,
// default to the onboarding flow. Preserves --help, --version,
// and all existing subcommands.

const knownCommands = new Set(
  program.commands.map((c) => c.name())
);

const userArgs = process.argv.slice(2);
const hasSubcommand = userArgs.some((a) => knownCommands.has(a));
const hasHelpOrVersion = userArgs.some((a) =>
  ["-h", "--help", "-V", "--version"].includes(a)
);

if (!hasSubcommand && !hasHelpOrVersion && userArgs.length === 0) {
  console.log(
    chalk.dim("No command specified — starting onboarding flow...\n")
  );
  process.argv.push("onboard", "--yes");
}

program.parse();
