# GPT Command Center Orchestrator MVP

## Task 22B routing foundation

The `/v1` API convention and existing detailed workflow states remain unchanged. Routing confidence is a separate domain dimension with `CLEAR`, `PROBABLE`, `AMBIGUOUS`, and `NO_MATCH`; decision types are `INITIAL`, `POST_CLARIFICATION`, `USER_OVERRIDE`, `DOWNSTREAM_ROUTE`, and `FALLBACK`. `AWAITING_CLARIFICATION` blocks unsafe routing until clarification, while `AWAITING_APPROVAL` blocks protected actions until explicit approval. Both clarification and approval state are durable in PostgreSQL.

The server-controlled specialist catalog records ownership, capabilities, exclusions, overlaps, logical upstream/downstream relationships, logical specialist status, runtime status, runtime identity, `registryVersion`, and `lastReviewedAt`. It contains the protected built-in seed catalog plus validated dynamic specialists; there is no product-level specialist-count maximum. When several existing specialists collectively cover a task, the system persists and executes an ordered orchestration plan before creating a new specialist. A specialist is a routing identity, not an executable runtime: `ACTIVE` runtime status is availability metadata and never means execution started. Runtime statuses are `ACTIVE`, `MANUAL_ONLY`, `UNVERIFIED`, and `DISABLED`.

For `NO_MATCH`, the policy is focused clarification, an existing-specialist orchestration plan where coverage is collective, or a validated dynamic specialist for a material capability gap. Task 22C adds PostgreSQL-authoritative durable routing history: decisions are append-only historical records, candidates belong to a specific decision, superseded decisions remain intact, and retrieval survives a new `PgStore` instance. Task 22D adds durable clarification requests/responses, restart-safe resume, and post-clarification routing history. Task 22E adds durable approval/rejection gating for materially changed protected actions; approval remains distinct from execution and approved actions resume through the normal execution safeguards. Task 22F adds validated task interpretation and deterministic, catalog-driven candidate selection: ownership precedes generic capability overlap, exclusions and logical status are authoritative, runtime availability remains separate, and candidate reasons are concise evidence templates. Dynamic specialists are persisted as validated logical definitions and are never granted runtime or repository authority merely by being created.

Approval material-change categories are `SCOPE`, `AUTHORITY`, `COST`, `EXTERNAL_ACCESS`, `SECURITY_PRIVACY`, and `EXECUTION_RISK`.

Greenfield TypeScript/Node service implementing evidence-gated specialist → Codex Prompt Builder → Codex → validation orchestration. The requested repository contained no pre-existing toolchain, so this MVP uses Node's built-in HTTP server, an in-memory adapter for local tests, and PostgreSQL schema SQL for production persistence wiring.

## Run

`npm install`, copy `.env.example` to `.env`, then apply migrations `001` through `008` in filename order, run `npm run build`, and `npm start`. Production startup requires `APP_MODE=deployed`, token authentication, PostgreSQL, and all current migration tables; it fails before listening when those requirements are missing or incompatible. `npm test` runs the state/evidence tests. `POST /v1/workflows`, `POST /v1/workflows/:id/run`, `GET /v1/workflows/:id`, `/events`, `/result`, clarification read/response routes, and approval read/decision routes are implemented, plus `/health` and `/ready`.

## Security and limitations

Registry entries are server-controlled; ChatGPT URLs are navigation-only. Client status/runtime/evidence fields are ignored. Only executor return facts can create completion artifacts. Manual-only/unverified runtimes hand off without execution events. `APP_MODE=deployed` fails closed until the PostgreSQL store is wired as the runtime authority; it never silently downgrades to `MemoryStore`. Local mode is explicitly selected with `APP_MODE=local` and may use the memory test adapter. OpenAI, Codex CLI, PostgreSQL, Docker/rootless-container execution, and approved repository configuration are external prerequisites and were not live-verified in this Windows environment. The rootless container adapter uses the observed Codex 0.152.0 `codex exec` contract and defaults to read-only root, no network, dropped capabilities, no-new-privileges, resource limits, and an explicit workspace mount.
## Task 22H user overrides

`POST /v1/workflows/:workflowId/override` validates a canonical active logical specialist and records a `USER_OVERRIDE` routing decision that supersedes the current route. The prior routing history and registry metadata remain unchanged; the override updates only the current workflow projection and never executes a specialist. Overrides may select a `MANUAL_ONLY` runtime and preserve the normal clarification and approval gates. An ambiguous clarification resolved by override is retained as historical `SUPERSEDED` clarification data.

## Specialist inventory

Specialist inventory discovery is configured with:

SPECIALIST_INVENTORY_PROVIDER=none|file
SPECIALIST_INVENTORY_FILE=/path/to/inventory.json

Operational endpoints:

GET /inventory-status
GET /ready

Readiness behavior:

- `none` + `UNVERIFIED` -> ready
- `file` + `VERIFIED` -> ready
- `file` + `UNVERIFIED` -> `503 not_ready`
- discovered specialists are never auto-approved or auto-routable

## Production operations

PostgreSQL is the durable production source of truth; `MemoryStore` is available only in explicitly selected local mode and is not restart-durable. Apply migrations `001` through `008` before starting a deployed instance. The application verifies database connectivity and required tables before it begins listening, while `/health` reports process liveness and `/ready` reports dependency/inventory readiness. Multi-specialist plans, stages, attempts, and stage-bound artifacts restore together with the workflow; completed software plans produce a bounded, labeled specialist-context artifact for Codex Prompt Builder. Uncertain runtime work follows manual-handoff recovery semantics.

## Release validation

Use a disposable PostgreSQL database for release validation; never run restore tests against production. Apply migrations in filename order, then run `npm run build`, `npm run lint`, `npm test`, and `npm audit --omit=dev`. PostgreSQL integration tests are enabled with `PG_TEST_URL`, for example `PGPASSWORD='<test-password>' PG_TEST_URL='postgresql://<user>@127.0.0.1:5433/<test-db>' npm test`. The mandatory `npm run test:postgres-certify` command fails closed when `PG_TEST_URL` is absent, applies migrations 001–008, reruns them for idempotency, verifies the application schema, and runs the full PostgreSQL-enabled suite. The repository CI workflow supplies a disposable PostgreSQL 16 service for this certification.

For a database recovery check, create a custom-format dump with `pg_dump -Fc -d <source-db> -f <backup-file>`, restore it into a separate empty database with `pg_restore --exit-on-error`, and verify application startup plus `/ready`. Restore the complete database so workflows, events, routing history, clarifications, approvals, attempts, artifacts, and idempotency records remain coherent. Provider validation requires deployment credentials and should use the repository's bounded executor/error tests plus a minimal non-destructive connectivity check; credentials must never be printed.

Workflow events, attempts, artifacts, routing history, clarifications, approvals, and idempotency records are retained in PostgreSQL until an operator applies an approved data-lifecycle policy. This repository does not implement automatic deletion or a backup service. Backups and restores are external operational responsibilities and must restore the related workflow tables together to preserve provenance and state integrity. Temporary execution workspaces are removed after successful or failed clone/executor paths; interrupted processes are represented through the existing recovery/manual-handoff flow.

SIGTERM/SIGINT stop readiness, stop accepting new work, close the HTTP server, and close the PostgreSQL pool. In-flight external execution is not claimed successful by shutdown; recovery/manual handoff remains the safe path when completion is uncertain.
