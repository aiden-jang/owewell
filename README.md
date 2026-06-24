# Owe Well

A bill-splitting app. Track who paid, who owes, and settle up with the fewest payments. Splits hotels, rental cars, bar rounds, groceries, whatever.

## Stack

- **Monorepo:** pnpm workspaces + TypeScript (strict)
- **Web:** React + Vite + Tailwind (responsive, desktop + mobile)
- **Server:** Fastify + Zod
- **Database:** PostgreSQL + Prisma
- **Auth:** session cookies (email + password)

Money is always stored as integer cents. Splits use largest-remainder rounding so shares always sum to the total, to the penny.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/shared` | Types and pure split-calculation logic (no I/O) |
| `packages/server` | Fastify API, Prisma, auth |
| `packages/web` | React app |

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
# owe-well
