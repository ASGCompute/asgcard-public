# Package Reference - Stellar MPP

## Core Packages

| Package | Purpose | Install |
|---------|---------|---------|
| `mppx` | Core MPP client and server runtime | `npm install mppx` |
| `@stellar/stellar-sdk` | Stellar keypairs, Soroban RPC, signing utilities | `npm install @stellar/stellar-sdk` |
| `stellar-mpp-sdk` | Stellar payment method bindings for MPP | `npm install github:stellar-experimental/stellar-mpp-sdk` |

## Charge Imports

| Need | Import |
|------|--------|
| Server charge flow | `stellar-mpp-sdk/server` |
| Client charge flow | `stellar-mpp-sdk/client` |
| Constants | `stellar-mpp-sdk` |

## Channel Imports

| Need | Import |
|------|--------|
| Channel method schema | `stellar-mpp-sdk/channel` |
| Channel client helpers | `stellar-mpp-sdk/channel/client` |
| Channel server helpers | `stellar-mpp-sdk/channel/server` |

## Suggested package.json - Server

```json
{
  "name": "my-stellar-mpp-server",
  "type": "module",
  "dependencies": {
    "@stellar/stellar-sdk": "^14.6.1",
    "express": "^4.21.2",
    "mppx": "^0.4.7",
    "stellar-mpp-sdk": "github:stellar-experimental/stellar-mpp-sdk"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.8.0"
  }
}
```

## Suggested package.json - Client

```json
{
  "name": "my-stellar-mpp-client",
  "type": "module",
  "dependencies": {
    "@stellar/stellar-sdk": "^14.6.1",
    "mppx": "^0.4.7",
    "stellar-mpp-sdk": "github:stellar-experimental/stellar-mpp-sdk"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.8.0"
  }
}
```

## Recommendation

If you are teaching or demoing MPP on Stellar right now, use the upstream `stellar-mpp-sdk` directly. If you need stronger product guarantees, freeze a fork or publish your own wrapper package after the API surface is stable.
