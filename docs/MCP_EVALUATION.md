# MCP-001: OpenZeppelin MCP Server — Evaluation Report

**Status**: Evaluated  
**Date**: 2026-03-04  
**Author**: CTO  
**Decision**: **KEEP** — adopt for development workflow, no runtime dependency

---

## What Is OZ MCP?

The OpenZeppelin Contracts MCP (Model Context Protocol) is a server at `mcp.openzeppelin.com` that integrates OZ's security standards and style rules into AI-assisted development workflows. It validates AI-generated smart contract code against OZ's rule-set in real-time.

### Capabilities

| Feature | Description | Our Relevance |
|---|---|---|
| Contract generation | ERC-20, ERC-721, ERC-1155, Governor — Solidity, Cairo, **Stellar/Soroban** | HIGH — M2 Smart Wallet will need Soroban contracts |
| Security validation | Checks code against OZ best practices | HIGH — reduces audit surface |
| IDE integration | Cursor, Claude, VS Code, Gemini, Windsurf | HIGH — team uses Cursor + Claude |
| Multi-chain support | EVM, Starknet, Arbitrum Stylus, Stellar | HIGH — Stellar is our chain |
| Documentation assist | OZ contract reference, API docs | MEDIUM — saves lookup time |
| Upgrade patterns | UUPS proxy patterns, safety checks | LOW — no upgradeable contracts yet |

### Setup

One-click from `mcp.openzeppelin.com` or via MCP config:

```json
{
  "mcpServers": {
    "openzeppelin": {
      "url": "https://mcp.openzeppelin.com/sse"
    }
  }
}
```

No API key required. No runtime dependency. No data leaves our codebase — the MCP server provides rules, not data.

## Value Assessment

### For M1 (Current — x402 Mainnet)

**Value: LOW.** Our M1 stack is Node.js/TypeScript API + Stellar SDK. We don't write Soroban contracts in M1. The MCP server's contract generation and validation features aren't used.

However, the MCP server can help with:

- Reviewing x402 facilitator integration patterns
- Checking our HMAC/crypto code against best practices
- Generating test contracts for integration testing

### For M2 (Smart Wallet / Agentic Spend Controls)

**Value: HIGH.** When we adopt Smart Wallets (ADR-003 deferred to M2), we'll need to:

1. Write Soroban smart wallet contracts with policy signers
2. Deploy OZ Smart Account library contracts
3. Configure spending limits, allow-lists, session keys

The MCP server directly accelerates all three:

- Generate policy signer contract scaffolding
- Validate contract security before deployment
- Ensure compliance with OZ Smart Account patterns

### Expected Productivity Gain

| Activity | Without MCP | With MCP | Gain |
|---|---|---|---|
| Soroban contract scaffolding | 2-3h manual | 15-30 min | ~80% |
| Security pattern review | 1-2h per contract | Automated | ~90% |
| OZ API reference lookup | Frequent context switches | In-IDE | ~50% |
| Integration test contracts | 1h each | 10 min | ~80% |
| **Estimated overall M2 savings** | — | — | **2-3 days** |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| MCP server downtime | LOW | Dev-time only, no runtime dependency |
| Generated code quality | MEDIUM | Always review + test before deploy |
| Lock-in to OZ patterns | LOW | OZ is industry standard for Stellar/Soroban |
| Data privacy | NONE | MCP provides rules, doesn't receive our code |

## Decision

**KEEP** — integrate into development environment now.

### Immediate Actions (today)

1. Add MCP config to team IDE setup (Cursor)
2. Document in team wiki

### Deferred Actions (M2)

1. Use for Soroban smart wallet contract generation
2. Use for policy signer scaffolding and validation
3. Evaluate OZ Defender integration for contract monitoring

---

## Comparison with Alternatives

| Tool | Scope | Runtime dep? | Stellar support? | Recommendation |
|---|---|---|---|---|
| OZ MCP | Contract gen + validation | No | Yes (Soroban) | ✅ Adopt |
| GitHub Copilot | General code assist | No | Partial | Already using |
| Alchemy SDK | RPC + monitoring | Yes | No | Skip |
| Tenderly | EVM debugging | Yes | No | Skip |
