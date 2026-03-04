# SW-002: Smart Wallet POC Specification

**Status**: Ready to implement (post FULL GO)  
**Date**: 2026-03-04  
**Author**: CTO  
**Prerequisite**: ADR-003 DEFER acknowledged; POC validates the M2 adoption plan

---

## Objective

Demonstrate 2 cases on Stellar testnet using OZ Smart Account library:

1. **SUCCESS**: Agent session key creates an ASG Card ($10 tier) — policy allows
2. **BLOCKED**: Same session key attempts $600 tier — policy spending limit blocks tx

## Architecture

```
Agent Runtime                    Stellar (Soroban)                   ASG Card API
┌────────────┐                  ┌──────────────────┐               ┌────────────┐
│            │  sign with       │  Smart Account   │               │            │
│ Session    │──session key────▶│  ┌─────────────┐ │               │            │
│ Key        │                  │  │ Policy:     │ │  signed tx    │            │
│ (ed25519)  │                  │  │ limit=$500  │─┼──────────────▶│ x402       │
│            │                  │  │ payTo=GBQL..│ │               │ verify     │
│            │                  │  │ ttl=24h     │ │               │ settle     │
└────────────┘                  │  └─────────────┘ │               └────────────┘
                                │  __check_auth()  │
                                └──────────────────┘
```

## Acceptance Criteria

### Case 1: SUCCESS ($10 tier within limit)

```
Input:
  - Session key with policy: {limit: $500, payTo: GBQL4G3..., ttl: 24h}
  - POST /cards/create/tier/10 with X-PAYMENT (signed via smart account)

Expected:
  - Smart account __check_auth() → PASS (amount $17.20 < $500 limit)
  - x402 verify/settle → SUCCESS
  - HTTP 201 with card data

Evidence:
  - Soroban tx hash (testnet)
  - API response with card_id
  - Smart account contract log showing policy pass
```

### Case 2: BLOCKED ($600 tier over limit)

```
Input:
  - Same session key, same policy
  - POST /cards/create/tier/500 (totalCost $522 > $500 limit)
  - Wait... $522 is just under $500? No:
    Tier $500 → totalCost = $522. Policy limit = $500.
    $522 > $500 → BLOCKED ✅

Expected:
  - Smart account __check_auth() → REJECT (amount $522 > $500 limit)
  - Stellar tx fails at submission (auth rejected)
  - Agent receives error before x402 even processes
  - No X-PAYMENT header sent to API (client-side rejection)

Evidence:
  - Soroban simulation showing auth rejection
  - Error message: "policy_limit_exceeded" or equivalent
  - No payment record in ASG Card DB
```

## Implementation Plan

### Step 1: Smart Account Contract (Soroban/Rust)

```rust
// Simplified — uses OZ Smart Account library structure
#[contract]
pub struct AgentWallet;

#[contractimpl]
impl AgentWallet {
    /// Initialize with owner (main signer) and default policy
    pub fn initialize(env: Env, owner: Address, policy: PolicyConfig) { ... }

    /// Add session signer with constraints
    pub fn add_session(
        env: Env,
        owner: Address,          // must be owner
        session_key: Address,    // temp ed25519 pubkey
        spend_limit: i128,       // max USDC amount (stroops)
        allowed_payees: Vec<Address>,
        ttl_seconds: u64,
    ) { ... }

    /// Soroban auth hook — called on every tx
    fn __check_auth(
        env: Env,
        signer: Address,
        context: AuthContext,
    ) -> Result<(), Error> {
        // 1. Is signer a valid session key?
        // 2. Is session expired?
        // 3. Is amount within remaining limit?
        // 4. Is destination in allowed_payees?
        // → All pass = authorize; any fail = reject
    }
}
```

### Step 2: Test Harness (TypeScript)

```typescript
// scripts/poc-smart-wallet.ts
import { SorobanRpc, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

async function runPOC() {
  // 1. Deploy AgentWallet contract to testnet
  // 2. Initialize with owner + policy (limit $500, payTo treasury, 24h)
  // 3. Generate session keypair
  // 4. Add session via add_session()
  // 5. Case 1: Build $17.20 USDC payment → sign with session key → submit
  //    Expected: SUCCESS
  // 6. Case 2: Build $522 USDC payment → sign with session key → simulate
  //    Expected: auth rejection
  // 7. Output results as JSON
}
```

### Step 3: Evidence Collection

Output `poc-smart-wallet-results.json`:

```json
{
  "contract_id": "C...",
  "testnet_explorer": "https://stellar.expert/explorer/testnet/contract/C...",
  "case1": {
    "status": "SUCCESS",
    "tx_hash": "...",
    "amount_usdc": 17.20,
    "policy_limit": 500,
    "policy_verdict": "PASS"
  },
  "case2": {
    "status": "BLOCKED",
    "simulation_error": "policy_limit_exceeded",
    "amount_usdc": 522,
    "policy_limit": 500,
    "policy_verdict": "REJECT"
  }
}
```

## Dependencies

| Dependency | Status | Action |
|---|---|---|
| Soroban SDK (Rust) | Available | Install `soroban-sdk` crate |
| OZ Smart Account lib | Available | `stellar-contracts` crate from OZ |
| Stellar testnet | Live | Use `stellar:testnet` + friendbot |
| Stellar SDK (TS) | Installed | `@stellar/stellar-sdk` v14.5.0 |

## Timeline

| Day | Deliverable |
|---|---|
| GO+1 | Deploy contract + case 1 (success) |
| GO+2 | Case 2 (blocked) + results report |

## Non-Goals

- Production deployment (M2)
- Client SDK changes (M2)
- Facilitator compatibility testing (M2)
- Multi-factor auth (M3+)
