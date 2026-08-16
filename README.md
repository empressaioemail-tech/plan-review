# plan-review

Empressa product: Codex plan review, housed like Smart Files. Own repo, own database, own serving process.

This is not cortex-api as the product home. Live cortex `/api/plan-review` functions are pulled here, then remounted on cortex as a proxy. Do not rewrite them from empty stubs. Calibration stays a later topic.

This is not legacy-design-tools `artifacts/plan-review` as the serving UI. This is not the Texas property-spine store. Hauska MCP is the agent gate; this service is the function host.

Do not put a cortex-prod, atoms, or smart-files `DATABASE_URL` in this repo or its deploy env.

Infra: GCP `plan-review-505715`. Cloud Run service `plan-review` in us-east1, revision `plan-review-00001-6l4` @100%. Live URL `https://plan-review-ozx33wafia-ue.a.run.app` (also `https://plan-review-364754576784.us-east1.run.app`). Neon DSN lives only at `%USERPROFILE%\.empressa\plan-review.database_url` locally and in Secret Manager on Cloud Run. Live probe is `GET /` (GFE intercepts exact `/healthz` on `*.run.app`).

Write the Neon URL (PowerShell, secret not printed):

```
powershell -File P:\plan-review\scripts\put-dsn.ps1
```

Then apply foundation:

```
node P:\plan-review\scripts\apply-sql.mjs sql\001_foundation.sql
```

Personas: `icc-demo/reviewer`, `icc-demo/observer`. G-60 / OPS-17. WDLL in doc_repo at `_inbox/2026-08-16_icc_demo_program_WDLL.md`.
