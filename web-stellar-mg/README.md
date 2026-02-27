# ASG Card Stellar (Isolated Variant)

This folder contains a separate landing page and documentation site focused on a Stellar-only product narrative.

## Isolation Guarantee

- All files live under `web-stellar-mg/`.
- Existing main website under `web/` is unchanged.
- Existing API behavior is reused where possible for speed.

## Run Locally

From repository root:

```bash
npm run dev:stellar
```

Or directly:

```bash
npm --prefix web-stellar-mg run dev
```

## Build

```bash
npm run build:stellar
```

## Notes

- Current pricing tables reuse `GET /pricing` shape from existing API.
- Swap `VITE_API_BASE_URL` when dedicated Stellar backend endpoint is ready.
