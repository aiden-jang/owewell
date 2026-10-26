# Deploying owewell → owewell.aidenjang.com

**Status: live** at `owewell.aidenjang.com` (D1 provisioned, custom domain attached). For a new
version use the **Routine redeploy** section below; the first-deploy steps are kept for reference.
One Cloudflare Worker (`owewell`) serves both the API (`/api/*`, `/health`) and the web SPA
(static assets) on one origin, `owewell.aidenjang.com`. Its own D1 (`owewell`) holds
groups/expenses/settlements and the local `people` registry. Cloudflare usage is subject to the
account's plan and limits.

owewell depends on the shared **auth service** (`accounts.aidenjang.com`) already being live:
it validates sessions by forwarding the `platform_session` cookie to `/auth/me` server-side,
and redirects to `accounts.aidenjang.com/login` for sign-in. The cookie is scoped to
`.aidenjang.com`, so it reaches `owewell.aidenjang.com` automatically.

All commands run from `packages/api`.

## First deploy (do these once, in order)

```bash
# 1. Create the production D1 and paste the printed database_id into wrangler.toml,
#    replacing "local-dev-placeholder".
pnpm exec wrangler d1 create owewell

# 2. Apply migrations to the remote D1.
pnpm exec wrangler d1 migrations apply owewell --remote

# 3. Custom-domain two-step: a Worker needs a deployment before a custom domain attaches.
#    - Comment out the [[routes]] custom_domain block in wrangler.toml.
pnpm run deploy            # builds owewell-web, applies migrations, then wrangler deploy
#    - Uncomment the [[routes]] block.
pnpm run deploy            # redeploy to attach owewell.aidenjang.com
```

- `AUTH_URL` is committed in `wrangler.toml` `[vars]` (`https://accounts.aidenjang.com`), so
  there is no auth secret to set.
- The account already has a `workers.dev` subdomain (registered for the auth deploy), so the
  `error 10063` from that step won't recur. `workers_dev = false` keeps owewell custom-domain-only.

## Routine redeploy (the usual case)

A direct, verified commit to `main` runs verification, then deploys the resulting client artifact after applying
migrations. CI does not rebuild that client. By hand, from the repo root:

```bash
pnpm run deploy       # the full CI gate, then ship
pnpm run deploy:only  # skip the gate (know why you're doing this)
```

From inside `packages/api`, `pnpm run deploy` is the ship step on its own, the same thing
`deploy:only` calls.

```bash
# API/config-only change (reuse the last-built SPA, and skip migrations):
pnpm exec wrangler deploy
```

- **This applies D1 migrations to the production database**, before the code ships and failing
  hard if they fail. That ordering is deliberate: shipping code whose migration has not run is
  what once 500'd `/auth/me` for every app. It also means a hand-run deploy is not a dry run:
  a migration that lands is landed.
- The root `deploy` runs `verify` first, which is the same list CI runs and in the same order.
  `dead-classes` has to come after the build; it diffs class names against the CSS Tailwind
  actually emitted. `gates` checks that every step in both lists names a script that exists.
- No re-login needed: `wrangler login` credentials persist across sessions.
- It's `pnpm exec wrangler deploy` (workspace binary), **not** `pnpm wrangler deploy`.
- `pnpm run deploy` (not bare `pnpm deploy`, which is pnpm's own command).

## Gotchas (from the auth deploy; expect the same here)

- **`Cannot attach custom domain: Worker has no deployments`** → the two-step in first deploy:
  deploy once with `[[routes]]` commented, then uncomment and deploy again.
- **Changing `database_id` orphans the local D1** (miniflare keys local storage by id). After
  editing it, re-run `pnpm exec wrangler d1 migrations apply owewell --local` for local dev.
- **`error 10063: need a workers.dev subdomain`** → only if the account subdomain was removed;
  re-register via Dashboard → Workers & Pages → subdomain.

## Smoke test

```bash
curl https://owewell.aidenjang.com/health          # {"status":"ok","service":"owewell"}
curl https://owewell.aidenjang.com/api/me           # {"user":null} when signed out
```

Then open `https://owewell.aidenjang.com`, use the signed-out quick split, click "Sign in"
(redirects to `accounts.aidenjang.com`, then back), create a group, add an expense, and confirm
balances + the live activity feed.

## Local development

Run the sibling Accounts service on port 34100 using its own development setup.
From this repository root, apply migrations and start the API and web app in
separate terminals:

```sh
pnpm --filter @owewell/api run db:migrate:local
pnpm run dev:api
pnpm run dev:web
```

The API development script overrides the committed production auth URL; the web dev server proxies
`/api` (including the realtime WebSocket) to `:34200`. `/owewell`, the old prefix, is proxied too.
