# GPT Command Center Orchestrator MVP

Greenfield TypeScript/Node service implementing evidence-gated specialist → Codex Prompt Builder → Codex → validation orchestration. The requested repository contained no pre-existing toolchain, so this MVP uses Node's built-in HTTP server, an in-memory adapter for local tests, and PostgreSQL schema SQL for production persistence wiring.

## Run

`npm install`, copy `.env.example` to `.env`, then `npm run build` and `npm start`. Apply `db/migrations/001_initial.sql` with PostgreSQL. `npm test` runs the state/evidence tests. `POST /v1/workflows`, `POST /v1/workflows/:id/run`, `GET /v1/workflows/:id`, `/events`, and `/result` are implemented, plus `/health` and `/ready`.

## Security and limitations

Registry entries are server-controlled; ChatGPT URLs are navigation-only. Client status/runtime/evidence fields are ignored. Only executor return facts can create completion artifacts. Manual-only/unverified runtimes hand off without execution events. `APP_MODE=deployed` fails closed until the PostgreSQL store is wired as the runtime authority; it never silently downgrades to `MemoryStore`. Local mode is explicitly selected with `APP_MODE=local` and may use the memory test adapter. OpenAI, Codex CLI, PostgreSQL, Docker/rootless-container execution, and approved repository configuration are external prerequisites and were not live-verified in this Windows environment. The rootless container adapter uses the observed Codex 0.152.0 `codex exec` contract and defaults to read-only root, no network, dropped capabilities, no-new-privileges, resource limits, and an explicit workspace mount.
