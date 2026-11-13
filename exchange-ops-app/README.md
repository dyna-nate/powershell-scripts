# Exchange Ops App

Dynatrace AppEngine UI for **custom:exchange-queue** (`custom.exchange.*` in Grail). The environment value is read from the `environment` dimension (`ENVIRONMENT_DIMENSION` in `ui/dql/queries.ts`).

**App id:** `my.exchange.ops` (Labs: `my.` + dots only — no hyphens)  
**Version:** see `app.config.json`  
**Layout:** dt-app v1.x (`ui/main.tsx` + `ui/tsconfig.json`)

## Screens

| Route | Purpose |
|-------|---------|
| `/` | Fleet Overview — servers, totals, top queues |
| `/hybrid-path` | On-prem hybrid backlog + Online connectors (Online gated until ingest) |
| `/queues` | Queue Explorer (Get-Queue) or Online connector explorer |
| `/mailboxes` | Top 50 mailboxes by size per server, per-database totals, storage limit status (optional mailbox task, installer switch `-IncludeMailboxStats`) |
| `/infrastructure` | Named KPIs, DAG copies, counters, services |
| `/mail-flow` | Graphical server → next-hop map |
| `/troubleshoot` | Stuck / Retry / Poison playbooks |
| `/compare` | Server A vs B, or path analogs when Online is configured |

## Customer / production behavior

- Default **Environment = On-prem** (persisted in `localStorage`)
- **Demo sample data is OFF** by default — empty Grail results show empty panels, not Contoso
- Toggle **Demo sample data** in the sidebar for walkthroughs only
- **Online** / **Both** slicer options stay disabled until `custom.exchange.online.*` is detected (or demo is on)
- Cluster networks panel is explicitly “not shown” (no fake Up rows)

## Local development

```bash
npm install
npm test
npx vite
```

Vite aliases `@dynatrace-sdk/react-hooks` to a shim (empty DQL). With demo **off**, the UI shows empty states — turn **Demo sample data** on in the sidebar, or set `VITE_DEMO_DATA=1` before `npx vite`, to load Contoso samples.

## Deploy

1. Set `environmentUrl` in `app.config.json` (or `DT_APP_ENVIRONMENT_URL`)
2. Keep `app.id` as **`my.exchange.ops`**
3. `npx dt-app@latest deploy --non-interactive` with `app-engine:apps:install`
4. Operators need `storage:buckets:read` + `storage:metrics:read`
5. Ensure extension feature sets match the screens you care about (see handoff README)

## Metrics / DQL

Builders: `ui/dql/queries.ts` · Catalog: [../docs/metric-catalog.md](../docs/metric-catalog.md) · App notes: [../docs/app-exchange-ops.md](../docs/app-exchange-ops.md)
