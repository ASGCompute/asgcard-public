# Stellar Team Announcement — ASG Card Mainnet Live

**Status:** DRAFT — Do not send until FULL GO confirmed  
**Send to:** Stellar Build Program team, Stellar Discord `#ecosystem-announcements`

---

## Subject: ASG Card — Mainnet x402 Live on Stellar

Hi Stellar team,

We're excited to announce that **ASG Card** is live on Stellar mainnet with full x402 v2 payment support.

**What it does:**  
ASG Card is a virtual card issuance API that enables AI agents to pay with USDC on Stellar using the x402 protocol. An agent can:

1. Receive a payment challenge (HTTP 402) with exact USDC amount
2. Submit a signed Stellar transaction as `X-PAYMENT` header
3. Receive a fully loaded virtual card (HTTP 201)

**Live endpoints:**

- API: <https://api.asgcard.dev>  
- Docs: <https://asgcard.dev>  
- OpenAPI: <https://asgcard.dev/openapi.json>  

**Technical details:**

- Protocol: x402 v2 (`exact` scheme)  
- Network: `stellar:pubnet`  
- Asset: USDC (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`)  
- Facilitator: OpenZeppelin Channels (`channels.openzeppelin.com/x402`)  
- Fees sponsored by facilitator (zero Stellar gas for payers)  

**Cards issued as of go-live:** [UPDATE AT GO DATE]  
**First on-chain tx hash:** [UPDATE AFTER E2E]  

We're proud to be one of the first production applications using x402 v2 on Stellar mainnet.

Best,  
ASG Card Team

---

## Internal Incident Template (NO-GO scenario)

**Template: Use if full GO is not achieved after funding**

```
INCIDENT REPORT — ASG Card Mainnet NO-GO
Date: [DATE]
Time: [UTC TIME]
Severity: P1

Summary:
  GO/NO-GO decision: NO-GO
  Reason: [specific failing metric/check]

Timeline:
  [TIME] Treasury funded
  [TIME] E2E test started
  [TIME] Issue detected: [describe]
  [TIME] Kill-switch activated (ROLLOUT_ENABLED=false)
  [TIME] Confirmed safe state

Metrics at time of incident:
  verify_error_rate_pct:            [value]
  settle_failed_rate_pct:           [value]
  trusted_webhook_sig_failure_rate: [value]
  replay_duplicates:                [value]
  p95_create_ms:                    [value]

Root cause hypothesis:
  [Describe suspected cause]

Actions taken:
  1. Kill-switch activated at [TIME]
  2. Vercel redeployed at [TIME]
  3. Confirmed 503 on paid path at [TIME]

Next steps:
  [ ] Root cause confirmed
  [ ] Fix deployed to staging
  [ ] CTO sign-off for re-enable
  [ ] Re-run E2E: npm run e2e:mainnet
  [ ] Re-run preflight: npm run preflight

Evidence links:
  - Vercel logs: [URL]
  - DB query result: [PASTE]
  - Horizon tx explorer: [URL if applicable]
```
