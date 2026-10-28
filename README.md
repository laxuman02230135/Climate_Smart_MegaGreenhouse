# Climate-Smart Greenhouse Prototype

Two-zone laboratory prototype for greenhouse monitoring and manual light control.

The web dashboard is in [`web/`](web/). It receives gateway telemetry through EMQX and presents Zone 1 and Zone 2 sensor readings.

## Run locally

```powershell
cd web
copy .env.example .env
pnpm install
pnpm dev
```

Set the EMQX connection values in `web/.env`. That file is intentionally excluded from Git.
