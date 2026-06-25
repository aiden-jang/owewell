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

## Notes

- **Cold starts**: `min_machines_running = 0` lets it sleep when idle (free). The first
  request after a quiet spell takes a few seconds, and any open real-time WebSocket
  reconnects on wake. Set `min_machines_running = 1` for always-on.
- **Receipt OCR** stays on the mock until you `fly secrets set ANTHROPIC_API_KEY=...`
  (uses Claude Haiku vision; cheap at hobby volume).
- **Scaling past one instance** would need the realtime bus moved from in-memory to
  Redis pub/sub (e.g. Upstash). Single instance is fine to start.
- Local dev is unchanged: `docker compose up -d db`, `pnpm --filter @owe-well/server dev`,
  `pnpm --filter @owe-well/web dev`.
