#!/bin/sh
# Rebuild dist/ExchangeQueueMetrics.zip from the scripts in this folder. Run before committing script changes.
set -e
cd "$(dirname "$0")"
stage=$(mktemp -d)
pkg="$stage/ExchangeQueueMetrics"
mkdir -p "$pkg"
cp Install-ExchangeQueueMetrics.ps1 Send-ExchangeQueueMetrics.ps1 Send-ExchangeMailboxMetrics.ps1 Get-ExchangeQueues.ps1 "$pkg/"
cat > "$pkg/INSTALL.txt" <<'T'
Exchange queue and mailbox metrics for Dynatrace (offline install)

1. Extract this zip anywhere on the Exchange server, for example C:\Temp\ExchangeQueueMetrics.
2. Open an elevated (Administrator) PowerShell in that folder and run:

   .\Install-ExchangeQueueMetrics.ps1 -SkipDownload -Credential (Get-Credential) -ExcludeEmpty -IncludeMailboxStats

   Enter the service account (DOMAIN\user) when prompted. Leave out -IncludeMailboxStats to skip the mailbox task.
3. To update later, extract a newer zip over the old folder and run the same command again.

Requires the Dynatrace OneAgent with the local metric API enabled (127.0.0.1:14499).
Details: README.md in the repo, "Server without access to GitHub".
T
rm -f dist/ExchangeQueueMetrics.zip
(cd "$stage" && zip -qr -X "$OLDPWD/dist/ExchangeQueueMetrics.zip" ExchangeQueueMetrics)
rm -rf "$stage"
unzip -l dist/ExchangeQueueMetrics.zip
