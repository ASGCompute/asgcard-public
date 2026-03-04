# ASG Card

ASG Card is an agent-focused virtual card platform powered by [x402](https://www.x402.org/) payments on the Stellar network.

## Overview

```
Agent → POST /cards/create/tier/25
  └─ No X-PAYMENT → 402 challenge (x402 v2, Stellar USDC)
  └─ Valid X-PAYMENT → facilitator verify → 201 card created
```

- **x402 v2** payment protocol with `PaymentPayload` and `X-PAYMENT` header
- **Stellar mainnet** (pubnet) with USDC settlement
- **Ed25519** wallet signature authentication

## Workspace

| Directory | Description |
|---|---|
| `/api` | ASG Card API (Express + x402 + wallet auth) |
| `/sdk` | `@asgcard/sdk` TypeScript client |
| `/web` | ASG Card website + docs |

## Links

- **API:** [api.asgcard.dev](https://api.asgcard.dev)
- **Docs:** [asgcard.dev/docs](https://asgcard.dev/docs)
- **OpenAPI:** [asgcard.dev/openapi.json](https://asgcard.dev/openapi.json)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development setup and guidelines.

## License

MIT — see [LICENSE](./LICENSE)
