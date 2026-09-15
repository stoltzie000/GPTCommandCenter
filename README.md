# GPT Command Center Orchestrator MVP

## Task 22B routing foundation

The `/v1` API convention and existing detailed workflow states remain unchanged. Routing confidence is a separate domain dimension with `CLEAR`, `PROBABLE`, `AMBIGUOUS`, and `NO_MATCH`; decision types are `INITIAL`, `POST_CLARIFICATION`, `USER_OVERRIDE`, `DOWNSTREAM_ROUTE`, and `FALLBACK`. `AWAITING_CLARIFICATION` blocks unsafe routing until clarification, while `AWAITING_APPROVAL` blocks protected actions until explicit approval. Both clarification and approval state are durable in PostgreSQL.

The server-controlled canonical specialist registry records ownership, capabilities, exclusions, overlaps, logical upstream/downstream relationships, logical specialist status, runtime status, runtime identity, `registryVersion`, and `lastReviewedAt`. A specialist is a routing identity, not an executable runtime: `ACTIVE` runtime status is availability metadata and never means execution started. Runtime statuses are `ACTIVE`, `MANUAL_ONLY`, `UNVERIFIED`, and `DISABLED`.

For `NO_MATCH`, the represented future policy order is focused clarification, an explicitly configured approved general fallback, or an explicit no-owner result. Task 22C adds PostgreSQL-authoritative durable routing history: decisions are append-only historical records, candidates belong to a specific decision, superseded decisions remain intact, and retrieval survives a new `PgStore` instance. Task 22D adds durable clarification requests/responses, restart-safe resume, and post-clarification routing history. Task 22E adds durable approval/rejection gating for materially changed protected actions; approval remains distinct from execution and approved actions resume through the normal execution safeguards. Task 22F adds validated task interpretation and deterministic, registry-driven candidate selection: ownership precedes generic capability overlap, exclusions and logical status are authoritative, runtime availability remains separate, and candidate reasons are concise evidence templates. Task 22F stops before final confidence policy. Phase 23 capability-gap behavior remains out of scope. The future gap outcomes remain `USE_EXISTING_SPECIALIST`, `EXPAND_EXISTING_SPECIALIST`, `SUGGEST_NEW_SPECIALIST`, and `NO_ACTION`; suggesting a specialist is not creating a GPT or mutating the registry.

Approval material-change categories are `SCOPE`, `AUTHORITY`, `COST`, `EXTERNAL_ACCESS`, `SECURITY_PRIVACY`, and `EXECUTION_RISK`.

Greenfield TypeScript/Node service implementing evidence-gated specialist → Codex Prompt Builder → Codex → validation orchestration. The requested repository contained no pre-existing toolchain, so this MVP uses Node's built-in HTTP server, an in-memory adapter for local tests, and PostgreSQL schema SQL for production persistence wiring.

## Run

`npm install`, copy `.env.example` to `.env`, then apply `db/migrations/001_initial.sql`, `db/migrations/002_task22c_routing_history.sql`, `db/migrations/003_task22d_clarifications.sql`, `db/migrations/004_task22e_approvals.sql`, and `db/migrations/005_task22h_override_clarification.sql`, run `npm run build`, and `npm start`. `npm test` runs the state/evidence tests. `POST /v1/workflows`, `POST /v1/workflows/:id/run`, `GET /v1/workflows/:id`, `/events`, `/result`, clarification read/response routes, and approval read/decision routes are implemented, plus `/health` and `/ready`.

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
