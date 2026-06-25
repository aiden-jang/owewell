# Deploying Owe Well

One Fastify app serves both the API (under `/api`) and the built web app, on a single
origin. No CORS, and the session cookie just works. Target: **owewell.aidenjang.com**.

## 1. Database (Neon, free)

1. Create a project at https://neon.tech and copy the connection string.
2. It looks like `postgresql://USER:PASSWORD@HOST/owewell?sslmode=require`.

## 2. App host (Fly.io, free-ish)

```bash
# from the repo root
fly launch --no-deploy            # detects the Dockerfile + fly.toml; pick the app name
fly secrets set DATABASE_URL="postgresql://...neon..."
fly deploy                        # builds the image, runs migrations on boot, starts
```

The container runs `prisma migrate deploy` on every boot, so the schema is applied
automatically. `WEB_DIR` and `NODE_ENV=production` are baked into the image.

## 3. Custom domain (you own aidenjang.com)

```bash
fly certs add owewell.aidenjang.com
```

Then add the DNS records Fly prints (a CNAME for `owewell` to your app's `*.fly.dev`
host, plus the ACME CNAME for the cert). HTTPS is issued automatically.

## Split origin (shared backend + free static frontend)

To run several apps off one backend and host each frontend free, point the API and the
web app at different origins. The frontend goes on Cloudflare Pages (or Vercel) for free;
the Fastify API runs once on Fly and is shared across apps.

**API (Fly), set as secrets:**

```bash
fly secrets set API_PREFIX="/owe-well"                 # this app's route namespace
fly secrets set CORS_ORIGINS="https://owewell.aidenjang.com"   # comma-separated allowlist
fly secrets set COOKIE_DOMAIN=".aidenjang.com"         # shared parent so the cookie crosses subdomains
```

Leave `WEB_DIR` unset so the API stops serving the SPA. Serve the API at
`api.aidenjang.com`; each additional app gets its own `API_PREFIX` and an entry in
`CORS_ORIGINS`.

**Frontend (Cloudflare Pages):** build `packages/web` (output `dist`). `public/_redirects`
already routes SPA paths to `index.html`. Set build-time env:

```
VITE_API_URL=https://api.aidenjang.com/owe-well
VITE_WS_URL=wss://api.aidenjang.com/ws
```

Cookies stay same-site because both are subdomains of `aidenjang.com`, so `SameSite=Lax`
keeps working (no fragile `SameSite=None`). Keep every frontend on an `aidenjang.com`
subdomain for this to hold.

## Notes

- **Always-on**: `min_machines_running = 1` with `auto_stop_machines = 'off'` keeps one
  machine warm so there are no idle cold starts (~$3-4/mo for one shared-cpu-1x). To trade
  that for near-zero cost at the price of a few-second wake, set `min_machines_running = 0`
  and `auto_stop_machines = 'stop'`.
- **Receipt OCR** stays on the mock until you `fly secrets set ANTHROPIC_API_KEY=...`
  (uses Claude Haiku vision; cheap at hobby volume).
- **Scaling past one instance** would need the realtime bus moved from in-memory to
  Redis pub/sub (e.g. Upstash). Single instance is fine to start.
- Local dev is unchanged: `docker compose up -d db`, `pnpm --filter @owe-well/server dev`,
  `pnpm --filter @owe-well/web dev`.
