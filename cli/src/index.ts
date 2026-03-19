#!/usr/bin/env node

/**
 * @asgcard/cli — ASG Card command line interface
 *
 * Manage virtual cards for AI agents from your terminal.
 * Authenticates via Stellar wallet signature (no API keys needed).
 *
 * Onboarding commands:
 *   asgcard install --client codex|claude|cursor  — Configure MCP for your AI client
 *   asgcard onboard [-y]                          — Full onboarding: wallet + MCP + skill + next step
 *   asgcard wallet create                         — Generate a new Stellar keypair
 *   asgcard wallet import                         — Import an existing Stellar secret key
 *   asgcard wallet info                           — Show wallet address, USDC balance, deposit info
 *   asgcard doctor                                — Diagnose your setup
 *
 * Card commands:
 *   asgcard login              — Set your Stellar private key (legacy, use wallet import)
 *   asgcard cards              — List your cards
 *   asgcard card <id>          — Get card details
 *   asgcard card:details <id>  — Get sensitive card info (PAN, CVV)
 *   asgcard card:create        — Create a new card (x402 payment)
 *   asgcard card:fund <id>     — Fund a card (x402 payment)
 *   asgcard card:freeze <id>   — Freeze a card
 *   asgcard card:unfreeze <id> — Unfreeze a card
 *   asgcard pricing            — View pricing
 *   asgcard health             — API health check
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ASGCardClient } from "@asgcard/sdk";
import { WalletClient } from "./wallet-client.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── Constants ───────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".asgcard");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const WALLET_FILE = join(CONFIG_DIR, "wallet.json");
const SKILL_DIR = join(homedir(), ".agents", "skills", "asgcard");
const VERSION = "0.2.0";

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const HORIZON_URL = "https://horizon.stellar.org";
const MIN_CARD_COST_USDC = 15.53; // $5 card: $5 + $10 + 3.5%

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
    console.log(chalk.dim("   1. Fund your wallet with at least ") + chalk.green(`$${MIN_CARD_COST_USDC} USDC`) + chalk.dim(" on Stellar"));
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
        const balanceColor = balance >= MIN_CARD_COST_USDC ? chalk.green : chalk.red;
        console.log(chalk.dim("   USDC Balance:   ") + balanceColor(`$${balance.toFixed(2)}`));
      }

      console.log(chalk.dim("   Min Required:   ") + chalk.dim(`$${MIN_CARD_COST_USDC} USDC (for $5 card + $10 issuance + 3.5%)`));
      console.log();

      if (!funded) {
        console.log(chalk.yellow("⚠ Your Stellar account is not funded yet.\n"));
        console.log(chalk.dim("   To activate your account, send at least 1 XLM + USDC to:"));
        console.log(chalk.cyan(`   ${pubKey}`));
        console.log(chalk.dim("\n   Then add a USDC trustline and deposit USDC."));
      } else if (balance < MIN_CARD_COST_USDC) {
        console.log(chalk.yellow("⚠ Insufficient USDC for card creation.\n"));
        console.log(chalk.dim("   Deposit at least ") + chalk.green(`$${MIN_CARD_COST_USDC} USDC`) + chalk.dim(" to your wallet:"));
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
  .description("Full onboarding: create/import wallet, install MCP, install skill, print next step")
  .option("-y, --yes", "Non-interactive mode (auto-create wallet, skip prompts)")
  .option("-c, --client <client>", "AI client to configure (codex, claude, cursor)")
  .action(async (options: { yes?: boolean; client?: string }) => {
    console.log(chalk.bold("\n🚀 ASG Card Onboarding\n"));

    // Step 1: Wallet
    console.log(chalk.bold("Step 1/4: Wallet"));
    let key = resolveKey();

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

    // Step 2: Install MCP for detected/specified clients
    console.log(chalk.bold("Step 2/4: MCP Configuration"));
    const clients: string[] = [];

    if (options.client) {
      clients.push(options.client.toLowerCase());
    } else {
      // Auto-detect installed clients
      if (existsSync(join(homedir(), ".codex"))) clients.push("codex");
      if (existsSync(join(homedir(), ".claude"))) clients.push("claude");
      if (existsSync(join(homedir(), ".cursor"))) clients.push("cursor");
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
        }
      }
    }
    console.log();

    // Step 3: Install product-owned skill
    console.log(chalk.bold("Step 3/4: Agent Skill"));
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

## Canonical Flow

1. **Check wallet status**: Use \`get_wallet_status\` MCP tool to verify wallet address and USDC balance
2. **Check pricing**: Use \`get_pricing\` to see pricing
3. **Create a card**: Use \`create_card\` with amount, name, and email
4. **Manage cards**: Use \`list_cards\`, \`get_card\`, \`get_card_details\`, \`freeze_card\`, \`unfreeze_card\`

## Zero Balance Handling

If wallet has insufficient USDC:
- Tell the user their current balance and the minimum required
- Provide their Stellar public key for deposits
- Explain: "Send USDC on Stellar to your wallet address, then retry"

## MCP Tools Available

| Tool | Description |
|------|-------------|
| \`get_wallet_status\` | Check wallet address, USDC balance, and readiness |
| \`get_pricing\` | View pricing (card $10, top-up 3.5%) |
| \`create_card\` | Create virtual MasterCard (pays USDC on-chain via x402) |
| \`fund_card\` | Top up existing card |
| \`list_cards\` | List all wallet cards |
| \`get_card\` | Get card summary |
| \`get_card_details\` | Get PAN, CVV, expiry (sensitive) |
| \`freeze_card\` | Temporarily freeze card |
| \`unfreeze_card\` | Re-enable frozen card |

## Important Notes

- All payments are in USDC on Stellar via x402 protocol
- Card details are returned immediately on creation (agent-first model)
- Wallet uses Stellar Ed25519 keypair — private key must stay local
- Minimum card cost is ~$15.53 USDC (for $5 card + $10 issuance + 3.5%)
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

    // Step 4: Wallet balance check and next step
    console.log(chalk.bold("Step 4/4: Status & Next Steps"));
    if (key) {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(key);
      const balance = await getUsdcBalance(kp.publicKey());

      if (balance === -1) {
        console.log(chalk.yellow("  ⚠ Could not check balance (Horizon API error)"));
        console.log(chalk.dim("     Check manually: ") + chalk.cyan("asgcard wallet info"));
      } else if (balance >= MIN_CARD_COST_USDC) {
        console.log(chalk.green("  ✅ Wallet funded!") + chalk.dim(` Balance: $${balance.toFixed(2)} USDC`));
        console.log(chalk.bold("\n  🎉 Ready! Create your first card:\n"));
        console.log(chalk.cyan("     asgcard card:create -a 10 -n \"AI Agent\" -e you@email.com -p +1234567890\n"));
      } else {
        console.log(chalk.yellow(`  ⚠ Balance: $${balance.toFixed(2)} USDC`) + chalk.dim(` (need $${MIN_CARD_COST_USDC} for minimum card)`));
        console.log(chalk.bold("\n  📥 Next step: Fund your wallet\n"));
        console.log(chalk.dim("     Send USDC on Stellar to:"));
        console.log(chalk.cyan(`     ${kp.publicKey()}\n`));
        console.log(chalk.dim("     Then check: ") + chalk.cyan("asgcard wallet info"));
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
        } else if (balance >= MIN_CARD_COST_USDC) {
          console.log(chalk.dim("  USDC Balance:     ") + chalk.green(`✅ $${balance.toFixed(2)}`));
        } else {
          console.log(chalk.dim("  USDC Balance:     ") + chalk.red(`❌ $${balance.toFixed(2)} (need $${MIN_CARD_COST_USDC} for $5 min card)`));
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

    if (mcpParts.length > 0) {
      console.log(chalk.dim("  MCP Configured:   ") + chalk.green(`✅ ${mcpParts.join(", ")}`));
    } else {
      console.log(chalk.dim("  MCP Configured:   ") + chalk.yellow("⚠ None — run: asgcard install --client <client>"));
    }

    console.log();
    if (allGood) {
      console.log(chalk.green("  ✅ All checks passed! You're ready to create cards.\n"));
    } else {
      console.log(chalk.yellow("  ⚠ Some checks failed. Fix the issues above and run ") + chalk.cyan("asgcard doctor") + chalk.yellow(" again.\n"));
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
  return Number.isFinite(num) && num >= AMOUNT_MIN && num <= AMOUNT_MAX;
}

program
  .command("card:create")
  .description("Create a new virtual card (pays on-chain via x402)")
  .requiredOption("-a, --amount <amount>", `Card load amount ($${AMOUNT_MIN}–$${AMOUNT_MAX})`)
  .requiredOption("-n, --name <name>", "Name on card")
  .requiredOption("-e, --email <email>", "Email for notifications")
  .requiredOption("-p, --phone <phone>", "Phone number (e.g. +1234567890)")
  .action(async (options: { amount: string; name: string; email: string; phone: string }) => {
    if (!isValidAmount(options.amount)) {
      remediate(
        `Invalid amount: ${options.amount}`,
        `Amount must be between $${AMOUNT_MIN} and $${AMOUNT_MAX}`,
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
        remediate(
          "Wallet has zero USDC balance",
          `You need USDC on Stellar to pay for card creation`,
          `Send USDC to: ${kp.publicKey()}\n         Check balance: asgcard wallet info\n         View pricing: asgcard pricing`
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
        amount: Number(options.amount) as 10 | 25 | 50 | 100 | 200 | 500,
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
        remediate(
          "Insufficient USDC balance",
          msg,
          `Deposit USDC to: ${kp.publicKey()}\n         Then retry: asgcard card:create -a ${options.amount} -n "${options.name}" -e ${options.email} -p ${options.phone}`
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
        amount: Number(options.amount) as 10 | 25 | 50 | 100 | 200 | 500,
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
