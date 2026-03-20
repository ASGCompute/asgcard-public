# Stellar MPP Client - Example

Node client that automatically responds to `402 Payment Required` using Stellar MPP charge mode.

## Setup

```bash
npm install
```

Set:

```bash
export STELLAR_SECRET=S...
export SERVER_URL=http://localhost:3000/premium/weather
```

## Run

```bash
npm start
```

The client installs the Stellar MPP method into `fetch`, requests the protected resource, signs the payment, and retries automatically.
