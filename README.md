# owewell

Split a bill, see who owes who, settle up. The kind of thing you reach for at the end of a group
dinner when nobody wants to do the math and everybody remembers it differently.

**Live:** [owewell.aidenjang.com](https://owewell.aidenjang.com)

`TypeScript` · `Hono` · `Cloudflare Workers` · `D1 + Drizzle` · `Durable Objects` · `React` · `Vite` · `Tailwind`

> Part of a [platform of apps](https://github.com/aiden-jang/platform/blob/main/PLATFORM.md) that share one sign-in. Runs entirely on Cloudflare's free tier.

---

## What it does

- **Groups with real members and placeholders.** Add people who have accounts _and_ people who
  don't (a placeholder is just a name). Rename or remove placeholders; a share link lets someone
  claim their own seat and become a real member. Balances recompute whenever membership changes.
- **Two kinds of expense.** A simple "one payer, split evenly (or by weight, percent, or exact
  amounts)" expense, or an **itemized** one where each line goes to specific people, with its own
  payer, plus tax and tip apportioned across the lines. Expenses can be backdated.
- **Corrections are on the record.** Editing an expense writes a revision, so the feed can say what
  changed and from what. Deleting is soft, and undo restores the same row down to the odd cent.
- **Settle up, honestly.** Record payments with a method (Venmo, PayPal, Cash App, Zelle, cash),
  including partial and manual ones, and undo one if you fat-finger it. owewell suggests the
  **fewest transfers** that clear everyone.
- **Works with no signal.** Writes typed offline are queued and replayed, with idempotency keys so
  a retry doesn't become a second dinner, and version checks so a late edit can't silently erase
  somebody else's.
- **Quick split, no login.** A signed-out one-shot splitter for "just tell me the number."
- **A read-only share link**, revocable, for people who aren't in the group.
- **Live.** Everyone in a group sees expenses and payments appear in real time.
- **Two themes**, following the device until you choose, and **archive** for groups you're done with.

## Architecture

```
                Browser (React + Vite + Tailwind)
        ┌──────────────────────────────────────────────┐
        │  Dashboard · GroupDetail · QuickSplit · /s/:token │
        │        │ fetch /api/*            ▲ live        │
        │        │                          │            │
        │   localStorage outbox ────────────┘ WebSocket  │
        └────────┼──────────────────────────────────────┘
                 │
        ╔════════▼════════════════════════════════════════╗
        ║   owewell Worker (Hono): one origin              ║
        ║   /api/*  API        +   app.all('*') → SPA      ║
        ║      │                                           ║
        ║      ├─ resolveSession  → accounts.aidenjang      ║  (optional; quick split is anonymous)
        ║      ├─ D1 + Drizzle   the ledger                ║
        ║      ├─ @owewell/shared  pure money/split math   ║
        ║      └─ GroupRoom (Durable Object) realtime      ║
        ╚══════════════════════════════════════════════════╝
```

Four packages, and the split between the middle two is the one worth knowing:

| package           | what's in it                                             | why separate                                                                                                                              |
| ----------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@owewell/api`    | Hono Worker, Drizzle queries, the `GroupRoom` DO         | the only thing that touches I/O                                                                                                           |
| `@owewell/web`    | React SPA                                                |                                                                                                                                           |
| `@owewell/shared` | `Money`, `allocateCents`, split methods, `simplifyDebts` | pure and dependency-free, so it can be tested without a network or a database, and the browser and the Worker run **the same** arithmetic |
| `@owewell/core`   | wire types, payment methods, expense categories          | shared vocabulary with no behaviour, so neither side can drift on the shape of a payload                                                  |

## Project layout

```
packages/
  api/       owewell Worker (Hono)
    src/index.ts        routes: /api/* API (+ /owewell alias) + SPA fallback; harden()
    src/groups.ts       groups and membership
    src/sharing.ts      the share link, and claiming a spot through one
    src/members.ts      real accounts + placeholders, seat claiming
    src/expenses.ts     writing a plain expense, and revisions
    src/itemizedExpenses.ts  writing a receipt: per-item people, payers, tax and tip
    src/expenseGuards.ts  the checks every expense write runs first
    src/expenseList.ts  assembling the tab
    src/balances.ts     reading the ledger: who is up, who is down
    src/settlements.ts  payments (methods, partial/manual) + min-cash-flow suggestions
    src/quicksplit.ts   anonymous one-shot split
    src/realtime.ts     GroupRoom Durable Object, live fan-out
    src/harden.ts       security headers + same-origin CSRF guard
    src/rateLimit.ts    per-IP limiting middleware
    src/shareToken.ts   share-link tokens (short, and the legacy shape)
    src/db/             Drizzle schema + client; migrations/ alongside
  web/       React + Vite + Tailwind SPA
    src/pages/          Dashboard, GroupDetail, QuickSplit, SharedGroup
    src/lib/            outbox, ledger hook, palettes, money formatting, CSV
  shared/    pure money/split math (@owewell/shared)
  core/      wire types, payment methods, categories (@owewell/core)
```

Nine D1 tables: `people`, `groups`, `group_members`, `expenses`, `expense_revisions`,
`expense_splits`, `expense_items`, `expense_item_shares`, `settlements`.

## Running locally

Requires **Node 22** (repo `.nvmrc`) and pnpm.

```bash
pnpm install

# API Worker on :34200 (Hono + local D1/DO via Miniflare). The dev script points AUTH_URL at the
# local auth service (:34100), so a local login is validated there (not production). Run auth too.
pnpm --filter @owewell/api dev

# web SPA (proxies /owewell to the Worker) - http://localhost:30001
pnpm --filter @owewell/web dev
```

Apply D1 migrations locally with `pnpm --filter @owewell/api db:migrate:local`.

`pnpm run verify` is the whole gate, and its last step drives a real browser. That needs Chromium
downloaded once:

```bash
pnpm --filter @owewell/web exec playwright install chromium
```

Without it `verify` gets all the way to the browser suite before failing, which is a slow way to
find out. The suite starts its own Worker against its own database (`.wrangler/e2e-state`), so it
neither needs `dev:api` running nor touches what you have been developing against.

See [DEPLOY.md](DEPLOY.md) for the production runbook, including the optional extras that are built
but not switched on.

## Data & database access

owewell's data lives in **Cloudflare D1** (SQLite), reached through **Drizzle** (schema in
`api/src/db/schema.ts`: `people`, `groups`, `group_members`, `expenses`, `expense_splits`,
`expense_items`, `expense_item_shares`, `settlements`, `invites`). Realtime state is _not_ in D1;
it stays in the in-memory `GroupRoom` Durable Object. Identity (users and sessions) is a separate
D1 owned by the auth service, not this one.

**Local.** `wrangler dev` uses a Miniflare-managed SQLite file under `api/.wrangler/state`, created
on first run and seeded by the local migrations. Inspect or edit it:

```bash
pnpm --filter @owewell/api exec wrangler d1 execute owewell --local \
  --command "SELECT id, name FROM groups LIMIT 5"
pnpm --filter @owewell/api exec wrangler d1 migrations apply owewell --local   # or: db:migrate:local
```

**Production.** The real D1. Same command with `--remote` (this is live user data, so keep it
read-only unless you mean it):

```bash
pnpm --filter @owewell/api exec wrangler d1 execute owewell --remote \
  --command "SELECT count(*) AS expenses FROM expenses"
pnpm --filter @owewell/api exec wrangler d1 migrations apply owewell --remote
```

Or use the Cloudflare dashboard: **Workers & Pages → D1 → owewell → Console** for an ad-hoc query UI.

**Changing the schema:** edit `api/src/db/schema.ts`, run `pnpm --filter @owewell/api db:generate`
(Drizzle writes a new file into `migrations/`), then apply it locally and, on deploy, remotely.

## Tests

```bash
pnpm -r test    # every suite: api, web, shared
```

Three registers, deliberately:

- **`shared`**: the arithmetic, with no I/O at all. Splits, remainders, netting, settlement.
- **`api`**: real routes against a real local D1 via `@cloudflare/vitest-pool-workers`, so the
  Drizzle queries and the migrations are exercised rather than mocked.
- **`web`**: mostly behaviour rather than markup. The outbox drain, the focus trap, the session's
  person-id remapping, the forms' reconciliation guards, the realtime socket's reconnect.

Four things the suite does that are worth copying:

**Authorisation is tested as a property, not per route.** Authentication is middleware and covers
everything; authorisation is a hand-written `requireMembership(...)` inside each of 26 service
functions, so a new one that forgets it compiles, lints, and passes every other test. One suite
walks every mutation and every group read as a signed-in stranger and asserts each is refused,
including that the refusal is identical for a group that does not exist, so ids stay unguessable.
The same checks are asserted on the _edit_ paths, not just create: an edit rewrites money already
in the ledger.

**It asserts the palette against the stylesheet.** `contrast.test.ts` parses `index.css` and checks
every colour matches its TypeScript copy, then measures the contrast ratios. A colour regression is
otherwise invisible until somebody complains.

**It is pinned to `America/New_York`.** An expense's date is a calendar day stored at UTC midnight,
so every bug in handling it is invisible from UTC, and CI runs in UTC. Pinning one zone means the
date tests assert the same thing everywhere, and the zone they assert in is one real users are in.

**Every API test starts from the production schema.** `test/apply-migrations.ts` runs the same
migrations wrangler applies, so a query is checked against the columns that actually exist rather
than a hand-written fixture of them.

**And one journey runs in a browser.** `packages/web/e2e` drives the real Worker against a real
local D1: sign in, make a group, add somebody, add an expense, read the balance it produces. Only
the auth service is a stand-in, because the session is checked server-side and there is no seam in
the browser to intercept it. It is the only layer that knows whether a person can actually get from
an empty account to a number they would act on.

`pnpm run verify` is the whole gate and CI runs the same list: `gates`, `size`, `comments`,
`check:docs`, typecheck, lint, `format:check`, build, `dead-classes`, unit tests, then the browser
journey.
`dead-classes` diffs the class names in the source against the CSS the build actually emitted: a
Tailwind class that never gets generated produces no CSS and no error, and it once caught a
`@custom-variant` shorthand that silently deleted all 114 hover styles while typecheck, lint and the
whole suite stayed green. It runs after `build` because it needs the emitted stylesheet.

## Observability

- **Errors + requests:** Workers Logs is enabled (`[observability]` in `wrangler.toml`), so uncaught
  throws and handled errors (via `app.onError`) are captured. Tail live with
  `pnpm --filter @owewell/api exec wrangler tail`.
- **Uptime:** `GET /health` returns `{ status: 'ok' }`, ready for a free external monitor (e.g.
  UptimeRobot).

## License

[MIT](LICENSE) © Aiden Jang
