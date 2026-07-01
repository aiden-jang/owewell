# owewell

A bill-splitting app. Track who paid, who owes, and settle up with the fewest payments. Splits hotels, rental cars, bar rounds, groceries, whatever.

The backend lives in the separate **platform** repo (a shared multi-app API); this repo is the owewell frontend only. In dev, the Vite server proxies `/api` and `/ws` to the platform API on `localhost:30000` (see `packages/web/vite.config.ts`).

## Stack

- **Monorepo:** pnpm workspaces + TypeScript (strict)
- **Web:** React + Vite + Tailwind (responsive, desktop + mobile)
- **Backend:** the platform repo (Fastify + Zod + Prisma + Postgres, session-cookie auth)

Money is always stored as integer cents. Splits use largest-remainder rounding so shares always sum to the total, to the penny.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/shared` | Types and pure split-calculation logic (no I/O), published as `@aidenjang/shared` |
| `packages/web` | React app (Vite dev server on `:30001`) |

## Getting started

Requires Node 20+ and pnpm 9+.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

## Scripts

| Command | Description |
| --- | --- |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint the repo |
| `pnpm format` | Format with Prettier |
| `pnpm test` | Run all package tests |
