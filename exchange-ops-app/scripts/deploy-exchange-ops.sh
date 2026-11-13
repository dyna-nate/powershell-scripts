#!/usr/bin/env bash
# Deploy prebuilt Exchange Ops app (no Node/npm required).
#
# Usage (from 04-app-exchange-ops):
#   export DT_APP_ENVIRONMENT_URL="https://YOUR_ENV.apps.dynatrace.com"
#   export DT_APP_PLATFORM_TOKEN="dt0s16...."
#   ./scripts/deploy-exchange-ops.sh
#
# Optional:
#   EXCHANGE_OPS_ZIP=/path/to/my.exchange.ops-x.y.z.zip
#   HTTPS_PROXY / HTTP_PROXY / ALL_PROXY as needed for corporate networks
#   CURL_CA_BUNDLE=/path/to/org-ca.pem   (if SSL inspection)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${DT_APP_ENVIRONMENT_URL:-}" ]]; then
  echo "ERROR: Set DT_APP_ENVIRONMENT_URL (apps host), e.g. https://xxxx.apps.dynatrace.com" >&2
  exit 1
fi
if [[ -z "${DT_APP_PLATFORM_TOKEN:-}" ]]; then
  echo "ERROR: Set DT_APP_PLATFORM_TOKEN to a Platform token (dt0s16...)" >&2
  exit 1
fi

DT_APP_ENVIRONMENT_URL="${DT_APP_ENVIRONMENT_URL%/}"

if [[ -n "${EXCHANGE_OPS_ZIP:-}" ]]; then
  ZIP="$EXCHANGE_OPS_ZIP"
else
  ZIP="$(ls -1 out/my.exchange.ops-*.zip 2>/dev/null | sort -V | tail -n 1 || true)"
fi
if [[ -z "${ZIP:-}" || ! -f "$ZIP" ]]; then
  echo "ERROR: No prebuilt zip found under out/my.exchange.ops-*.zip" >&2
  echo "Ask the package builder to regenerate the handoff with a dry-run artifact." >&2
  exit 1
fi

echo "Environment : $DT_APP_ENVIRONMENT_URL"
echo "Artifact    : $ZIP"

echo "Auth probe..."
HTTP_CODE="$(curl -sS -o /tmp/dt-user.json -w "%{http_code}" \
  -H "Authorization: Bearer ${DT_APP_PLATFORM_TOKEN}" \
  "${DT_APP_ENVIRONMENT_URL}/platform/metadata/v1/user" || true)"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: Platform token auth failed (HTTP $HTTP_CODE)." >&2
  head -c 400 /tmp/dt-user.json 2>/dev/null || true
  echo
  exit 1
fi
echo "Auth OK."

echo "Uploading app to registry..."
HTTP_CODE="$(curl -sS -o /tmp/dt-install.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${DT_APP_PLATFORM_TOKEN}" \
  -H "Content-Type: application/zip" \
  --data-binary @"${ZIP}" \
  "${DT_APP_ENVIRONMENT_URL}/platform/app-engine/registry/v1/apps" || true)"

echo "Registry HTTP $HTTP_CODE"
if [[ -f /tmp/dt-install.json ]]; then
  head -c 800 /tmp/dt-install.json; echo
fi

case "$HTTP_CODE" in
  200|201|202)
    echo
    echo "Deploy accepted."
    echo "Open: ${DT_APP_ENVIRONMENT_URL}/ui/apps/my.exchange.ops"
    ;;
  *)
    echo "ERROR: Deploy failed (HTTP $HTTP_CODE)." >&2
    echo "If the message says the same version is already installed with a different checksum," >&2
    echo "the builder must bump app.version and regenerate the zip." >&2
    exit 1
    ;;
esac
