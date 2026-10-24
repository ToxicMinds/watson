# Watson

A consultation documentation tool for Ayurveda and integrative-care practitioners:
two audio tracks in, a transcript the practitioner can check and correct out.

**Development proof of concept. Invented data only. Not for use with real patients.**

- What we are building and in what order: [MASTER_BUILD_SPEC.md](MASTER_BUILD_SPEC.md)
- Where we are: [docs/roadmap.md](docs/roadmap.md)
- Why things are the way they are: [docs/decision-log](docs/decision-log/)

## What runs where

| Piece | Where | Cost |
|---|---|---|
| Web app (`apps/web`) | Render static site | Free |
| Sign-in, database, audio files (`supabase`) | Supabase, Frankfurt | Free |
| Transcription engine (`apps/clinical-worker`) | A machine we control | Free |

Nothing in this project may be charged for (specification, section 3).

## Prerequisites

- Node 22 or newer and pnpm 11
- [uv](https://docs.astral.sh/uv/), which installs Python 3.12 for the engine
- Docker and the [Supabase command-line tool](https://supabase.com/docs/guides/cli), for the local stack

## Set up

    pnpm install
    supabase start                         # local sign-in, database and storage in Docker
    (cd apps/web && node scripts/use-local-stack.mjs)
    (cd apps/clinical-worker && uv sync && WATSON_MODEL=tiny uv run clinical-worker fetch-model)
    (cd apps/clinical-worker && uv run clinical-worker fetch-form-model)   # 2.7 GB, fills in forms

Patient payment needs a Stripe test key on the hosted project (`supabase secrets set
STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... SITE_URLS=https://watson-assists.onrender.com`)
and a webhook endpoint at `<project>/functions/v1/stripe-webhook` (decision 0007).

## Run all of Watson on one computer

    scripts/local.sh setup && scripts/local.sh start     # then http://localhost:3000

The database, engine and website all on one Mac (or Linux machine), payments and Google Calendar off
unless their test keys are added: see [docs/run-locally.md](docs/run-locally.md).

## Check everything

    pnpm check                             # tests, lint and type checks for every package
    (cd apps/web && pnpm e2e)              # builds the web app and drives it in a real browser

The web tests need the local stack to be running.

## Work on the web app

    cd apps/web && pnpm dev                # http://localhost:3000

Accounts cannot be created from the app. Locally, the tests create their own. On the
hosted project the owner creates them in the Supabase dashboard.

## Change the database

    supabase migration new describe_the_change    # then write the SQL
    supabase db reset                             # rebuild the local database from all migrations
    supabase gen types typescript --local > apps/web/src/lib/database.types.ts
    supabase db push                              # apply to the hosted project

Hosted sign-in rules (no public sign-up, 12-character passwords) are applied with
`scripts/configure-hosted-auth.sh`.

## Publish the web app

    git push origin main
    scripts/deploy-web.sh                  # builds on Render from main and waits until it is live
    (cd apps/web && E2E_BASE_URL=https://watson-assists.onrender.com E2E_EMAIL=... E2E_PASSWORD=... pnpm exec playwright test)

The last line drives the live app in a browser with a dedicated test account, never the
owner's.

## Layout

    apps/web                 web app
    apps/clinical-worker     transcription engine
    packages/schemas         JSON Schema generated from the engine's models
    packages/test-fixtures   synthetic audio only
    supabase                 migrations and local configuration
    docs                     roadmap, decision log, archived specification
    scripts                  helper scripts

## Known limitations

- The engine is still the single-track version from phase 0. It is connected to the
  web app in slice 1.3.
- The local Supabase stack listens on all network interfaces with well-known default
  keys. Stop it with `supabase stop` when you are not developing.
