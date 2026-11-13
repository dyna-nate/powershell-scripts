# Exchange Ops - deploy (no Node required)

Prebuilt zip: `out\my.exchange.ops-1.1.6.zip`

Token scopes: `app-engine:apps:install` (and `app-engine:apps:run` to open the app).
Use the Dynatrace **apps** host (`https://<env-id>.apps.dynatrace.com`), not `*.live.dynatrace.com`.

## Windows (PowerShell)

```powershell
cd .\04-app-exchange-ops

$env:DT_APP_ENVIRONMENT_URL = "https://YOUR_ENV.apps.dynatrace.com"
$env:DT_APP_PLATFORM_TOKEN  = "dt0s16...."

.\scripts\deploy-exchange-ops.ps1
```

## Mac / Linux

```bash
cd 04-app-exchange-ops

export DT_APP_ENVIRONMENT_URL="https://YOUR_ENV.apps.dynatrace.com"
export DT_APP_PLATFORM_TOKEN="dt0s16...."

chmod +x ./scripts/deploy-exchange-ops.sh
./scripts/deploy-exchange-ops.sh
```

Replace `YOUR_ENV` with the SI or Prod environment id, and paste a platform token from that same environment.

Full SI/Prod instructions: `..\05-docs\app-deploy-si-prod.md`
