# Stellar MPP Server - Example

Small Express API that charges `0.01` USDC per request on Stellar testnet.

## Setup

```bash
npm install
```

Set:

```bash
export STELLAR_RECIPIENT=G...
export MPP_SECRET_KEY=dev-secret
```

## Run

```bash
npm run dev
```

## Endpoints

| Endpoint | Price | Notes |
|----------|-------|-------|
| `GET /health` | free | basic health check |
| `GET /premium/weather` | `0.01` USDC | protected by Stellar MPP |

## Test

```bash
curl http://localhost:3000/health
curl -i http://localhost:3000/premium/weather
```
