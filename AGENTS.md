# Watson — AGENTS.md

This is a compact instruction file for OpenCode sessions working in the Watson repository.
Every line answers: "Would an agent likely miss this without help?" If not, it's left out.

## Monorepo Structure

- **pnpm workspace** with `turbo` orchestration
- `apps/web` — Next.js 16 static site (`output: 'export'`)
- `apps/clinical-worker` — Python transcription engine (faster-whisper)
- `apps/whatsapp-gateway` — **Excluded from pnpm installs**; ships as its own Docker image
- `packages/schemas` — generated JSON Schema from engine Pydantic models
- `packages/test-fixtures` — synthetic audio/fixtures only; never real patient data
- `supabase` — migrations, local configuration, database functions
- `scripts` — helper scripts (local.sh, deploy, configure-*)

**Key boundary**: `apps/whatsapp-gateway` is excluded from every pnpm install and CI run from `pnpm-workspace.yaml` line 5.

## Developer Commands (exact, non-obvious)

| Goal | Command |
|---|---|
| Install deps (frozen) | `pnpm install --frozen-lockfile` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Test all | `pnpm test` |
| Check everything | `pnpm check` (lint + typecheck + test) |
| Local setup (once) | `scripts/local.sh setup` |
| Local start | `scripts/local.sh start` |
| Local stop | `scripts/local.sh stop` |
| Local check (e2e) | `scripts/local.sh check` |
| Build web | `(cd apps/web && pnpm build)` |
| Web dev | `cd apps/web && pnpm dev` |
| Web e2e | `(cd apps/web && pnpm e2e)` (needs local stack running) |
| Supabase start | `supabase start` (with `-x analytics,vector,imgproxy,studio,inbucket,edge-runtime`) |
| Supabase stop | `supabase stop` |
| Supabase migration new | `supabase migration new describe_the_change` |
| Supabase db reset | `supabase db reset` |
| Supabase gen types | `supabase gen types typescript --local > apps/web/src/lib/database.types.ts` |
| Push types to hosted | `supabase db push` |
| Deploy web | `scripts/deploy-web.sh` |
| Fetch OCR model | `(cd apps/clinical-worker && uv sync && uv run clinical-worker fetch-ocr-model)` |
| Fetch all engine models | `(cd apps/clinical-worker && uv sync && uv run clinical-worker fetch-model && uv run clinical-worker fetch-form-model)` |

## Environment & Prerequisites

- **Node 22+** and **pnpm 11** (verified via `.nvmrc` / engine config)
- **uv** — installs Python 3.12 for the clinical-worker engine
- **Docker** — Supabase local stack requires it running
- **Supabase CLI** — `supabase/tap/supabase` (Homebrew: `brew install supabase/tap/supabase`)
- **Stripe test keys** — optional; set in `.local/online.env` if needed
- **Google Cloud keys** — optional for Google Calendar

**Critical env vars** (see `.local/online.env` for optional ones):
- `WATSON_ENV_FILE` — path to engine env, set by `scripts/local.sh`
- `WATSON_MODEL` — model size for transcription (default: `small`)
- `WATSON_VOCABULARY` — Ayurvedic terms hint string

## Build & Data Flow

1. **Web build**: `pnpm build` runs `next build && node --env-file-if-exists=.env.local scripts/inject-csp.mjs`
2. **Typegen**: `supabase gen types typescript --local` generates `apps/web/src/lib/database.types.ts`
3. **Database changes**: `supabase migration new|push` — versioned SQL migrations only
4. **Engine models**: Fetched once via `uv sync + uv run clinical-worker fetch-model` (~5 GB first time)
5. **Transcription**: Engine signs in as its own account, pulls jobs from Supabase DB, downloads tracks, transcribes with faster-whisper, returns merged transcript

## Testing Quirks

| Suite | Command | Prerequisites |
|---|---|---|
| Unit/tests (web) | `pnpm test` (vitest) | None beyond deps |
| Lint (web) | `pnpm lint` (eslint) | None |
| Typecheck (web) | `pnpm typecheck` (next typegen + tsc) | Requires `supabase gen types` first |
| Unit/tests (clinical) | `uv run pytest -q` | Engine models fetched |
| E2E (playwright) | `pnpm exec playwright test -c playwright.local.config.ts` | `scripts/local.sh start` running; local stack online |
| E2E (web) | `(cd apps/web && pnpm e2e)` | Same as above + build |

**Flaky/expensive**: Full e2e suite needs local Supabase stack + engine running. Can take 5+ minutes.

## Architecture Notes (not obvious from filenames)

- **WhatsApp gateway** is a standalone Node.js app (`server.mjs`); its `package.json` is outside the pnpm workspace. Do not `pnpm install` it from root.
- **Engine runs as a persistent user service** (`apps/clinical-worker/watson-engine.service`). It pulls jobs from Supabase every 10s, claims one at a time, transcribes, reports back. Never run it manually via `node` — use `scripts/local.sh start`.
- **Database functions are the only state changes** — see `MASTER_BUILD_SPEC.md` Part II, section 8.2. No direct SQL outside migrations.
- **Web app is static (`output: 'export'`)**: No server runtime. All data routing goes through Supabase RLS. The browser holds sessions; every write is a database function.
- **`apps/whatsapp-gateway` excluded from installs**: Its `package-lock.json` and Docker image are managed separately. Adding a new package? Check `pnpm-workspace.yaml` first — only add to `packages/*` or `apps/*`.
- **Codegen is enforced**: JSON Schema in `packages/schemas` is generated from engine Pydantic models. Hand-written copies are not allowed (see `MASTER_BUILD_SPEC.md` 8.1).
- **Supabase local stack listens on all network interfaces** with well-known default keys. Stop it with `supabase stop` when not developing.

## Operational Gotchas

- `scripts/local.sh setup` is **idempotent** but downloads ~2 GB (Supabase stack) and ~5 GB (engine models) the first time.
- After `scripts/local.sh start`, wait for `curl -fs -o /dev/null http://localhost:3000/sign-in` to succeed before running e2e.
- Stripe/test payments need `.local/online.env` with `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URLS`.
- Google Calendar needs `.local/online.env` with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `supabase start` with `-x analytics,vector,imgproxy,studio,inbucket,edge-runtime` reduces resource usage.
- The engine **listens on no port** and makes outbound HTTPS only. If it can't connect to Supabase, it won't claim jobs.
- Web e2e needs the local stack running AND the web built. Order matters: `build_web` first, then e2e.
- `scripts/local.sh check` runs playwright test; it signs in with credentials from `.local/logins.env`.
- **Never commit audio recordings** of real people. Synthetic mode only; real patient data is forbidden until Gate R.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
