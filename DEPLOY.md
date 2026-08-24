# Deploying owewell → owewell.aidenjang.com

**Status: live** at `owewell.aidenjang.com` (D1 provisioned, custom domain attached). For a new
version use the **Routine redeploy** section below; the first-deploy steps are kept for reference.
One Cloudflare Worker (`owewell-api`) serves both the API (`/owewell/*`, `/health`) and the web SPA
(static assets) on one origin, `owewell.aidenjang.com`. Its own D1 (`owewell`) holds
groups/expenses/settlements and the local `people` registry. Free tier; you pay only for DNS.

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

# 3. Create the R2 bucket for receipt photos. CI does NOT do this: `pnpm run deploy` applies D1
#    migrations, but nothing creates a bucket, and `wrangler deploy` fails on an [[r2_buckets]]
#    binding whose bucket does not exist. The CI token (Workers Scripts:Edit + D1:Edit) could not
#    create one anyway.
pnpm exec wrangler r2 bucket create owewell-receipts

# 4. Custom-domain two-step: a Worker needs a deployment before a custom domain attaches.
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

```bash
pnpm run deploy            # builds the SPA, applies pending migrations, then deploys
# API/config-only change (reuse the last-built SPA, and skip migrations):
pnpm exec wrangler deploy
```

- No re-login needed: `wrangler login` credentials persist across sessions.
- It's `pnpm exec wrangler deploy` (workspace binary), **not** `pnpm wrangler deploy`.
- `pnpm run deploy` (not bare `pnpm deploy`, which is pnpm's own command).

## Optional: receipt OCR with Claude

Receipt scanning needs **both** pieces, set together (like Turnstile/Google elsewhere):

```bash
# 1. the API key (server): without it the endpoint returns a mock receipt, zero cost
echo "<anthropic-api-key>" | pnpm exec wrangler secret put ANTHROPIC_API_KEY

# 2. the build flag (web): reveals the "Scan a receipt" button
VITE_OCR_ENABLED=true pnpm --filter @owewell/web build && pnpm exec wrangler deploy
```

The button is gated on `VITE_OCR_ENABLED` on purpose: with the flag on but no key set, every
scan would return the mock line items (pizza / salad / water) in production. Set the key first, or
leave the flag off and the button stays hidden. Uses the cheapest vision model
(`claude-haiku-4-5`); set your own spend cap on the Anthropic account (one request per receipt).

## Gotchas (from the auth deploy; expect the same here)

- **`The specified bucket does not exist`** on deploy → step 3 above was skipped. Buckets are not
  created by the deploy; only D1 migrations are.
- **`Cannot attach custom domain: Worker has no deployments`** → the two-step in first deploy:
  deploy once with `[[routes]]` commented, then uncomment and deploy again.
- **Changing `database_id` orphans the local D1** (miniflare keys local storage by id). After
  editing it, re-run `pnpm exec wrangler d1 migrations apply owewell --local` for local dev.
- **`error 10063: need a workers.dev subdomain`** → only if the account subdomain was removed;
  re-register via Dashboard → Workers & Pages → subdomain.

## Smoke test

```bash
curl https://owewell.aidenjang.com/health          # {"status":"ok","service":"owewell"}
curl https://owewell.aidenjang.com/owewell/me       # {"user":null} when signed out
```

Then open `https://owewell.aidenjang.com`, use the signed-out quick split, click "Log in"
(redirects to `accounts.aidenjang.com`, then back), create a group, add an expense, and confirm
balances + the live activity feed.

## Local dev (no Cloudflare needed)

```bash
# auth service (:34100) + owewell API (:34200) + owewell web (:30001)
# auth now lives in its own repo — run it from there:
cd ../auth/packages/api && pnpm exec wrangler dev --port 34100 --inspector-port 9229 --local
# owewell (this repo):
cd packages/api && pnpm exec wrangler dev --port 34200 --inspector-port 9230 --local --var AUTH_URL:http://localhost:34100
cd packages/web && pnpm dev
```

The `--var AUTH_URL:...` overrides the committed prod value; the web dev server proxies
`/owewell` (including the realtime WebSocket) to `:34200`.
