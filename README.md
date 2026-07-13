# owewell

Split a bill, see who owes who, settle up. The kind of thing you reach for at the end of a group
dinner when nobody wants to do the math and everybody remembers it differently.

**Live:** [owewell.aidenjang.com](https://owewell.aidenjang.com)

`TypeScript` · `Hono` · `Cloudflare Workers` · `D1 + Drizzle` · `Durable Objects` · `React` · `Vite` · `Tailwind`

> Part of a [platform of apps](https://github.com/aiden-jang/platform/blob/main/PLATFORM.md) that share one sign-in. Runs entirely on Cloudflare's free tier.

---

## What it does

- **Groups with real members and placeholders.** Add people who have accounts *and* people who
  don't (a placeholder is just a name). Rename or remove placeholders; promote them when they sign
  up. Balances recompute whenever membership changes.
- **Two kinds of expense.** A simple "one payer, split evenly (or by weight)" expense, or an
  **itemized** one where each line goes to specific people (the classic "you got the steak, I got
  a salad" problem). Expenses can be backdated.
- **Receipt OCR.** Snap a receipt and a vision model extracts the line items so you itemize by
  tapping names instead of typing prices.
- **Settle up, honestly.** Record payments with a method (Venmo, PayPal, Cash App, Zelle, cash,
  …), including **partial** and **manual** payments, and undo one if you fat-finger it. owewell
  suggests the **fewest transactions** that clear everyone's balance.
- **Quick split, no login.** A signed-out one-shot splitter for "just tell me the number."
  Accounts add persistence, groups, and history.
- **Live.** Everyone in a group sees expenses and payments appear in real time.
- **Archive** groups you're done with instead of deleting the history.

---

## Architecture

```
                Browser (React + Vite + Tailwind)
        ┌────────────────────────────────────────────┐
        │  Dashboard · GroupDetail · QuickSplit        │
        │        │ fetch /owewell/*        ▲ live       │
        └────────┼─────────────────────────┼───────────┘
                 │                          │ WebSocket
        ╔════════▼══════════════════════════════════════╗
        ║   owewell Worker (Hono)  - one origin          ║
        ║   /owewell/*  API    +   app.all('*') → SPA    ║
        ║      │                                         ║
        ║      ├─ getSessionUser → accounts.aidenjang    ║  (optional; quick split is anonymous)
        ║      ├─ D1 + Drizzle   groups, expenses,        ║
        ║      │                 splits, settlements      ║
        ║      ├─ @owewell/core  pure money/split math    ║
        ║      ├─ GroupRoom (Durable Object) realtime     ║
        ║      └─ OCR → vision model (itemize receipts)   ║
        ╚════════════════════════════════════════════════╝
```

## Decisions worth explaining

**Money is integer cents, everywhere.** Floats and money don't mix: `0.1 + 0.2` alone should end
the debate. Every amount is an integer number of cents from the API boundary through the database.
The split math also has to decide who eats the leftover cent when a total doesn't divide evenly;
doing that on floats would silently lose or invent money.

**The split math is a pure package (`@owewell/core`), tested without any I/O.** All the logic that
actually matters (even splits, weighted splits, itemized allocation, remainder distribution,
balance netting, and the minimum-cash-flow settlement suggestion) lives in a dependency-free
package with unit tests. The Worker is a thin shell that reads D1, calls core, and writes back.
The rules I most want to be *correct* are the ones furthest from the network.

**D1 for the ledger, a Durable Object for the live feed.** The data is relational (groups have
members, expenses have splits, settlements reference both), so D1 + Drizzle is the natural home.
Realtime is a different shape (a short-lived fan-out to whoever's looking at one group), so each
group gets a `GroupRoom` Durable Object that holds no durable state and just relays "something
changed." Using the hibernation WebSocket API means an idle room costs nothing. *Why not push
everything through the DO?* Because durable relational data in a single-threaded object is the
wrong tool; D1 is the source of truth and the DO is a notification bus.

**Accounts are optional.** Quick split works signed out because the highest-friction moment is the
one where you just want a number at the table. Accounts unlock groups, history, and invites. The
same `/owewell/me` endpoint returns `{ user: null }` rather than a 401 so the client can treat
signed-out as a normal state, not an error.

**Placeholders are first-class.** Real life is "me, my roommate, and the two friends who'll
Venmo me later." Placeholders let you model that group immediately; a guard (`NOT_PLACEHOLDER`)
stops you from renaming a real account as if it were one.

## Trade-offs

- **OCR is best-effort.** A vision model reads most receipts well and mangles the occasional
  faded one. It's a fast path to itemizing, not a guarantee: you can always edit the lines.
- **Settlement suggests, it doesn't move money.** owewell computes the fewest transfers and tags
  the method; the actual payment happens in Venmo/cash/etc. Integrating a payments API is a
  whole different trust-and-compliance surface I deliberately stayed out of.
- **Realtime is a "refetch" nudge, not a CRDT.** The DO broadcasts "group changed" and clients
  refetch, rather than syncing granular ops. Simple and correct for this scale; a busy shared
  group would want diffed updates.

## Project layout

```
api/                          owewell Worker (Hono)
  src/index.ts                routes: /owewell/* API + SPA fallback; harden() middleware
  src/groups.ts               groups + membership (real accounts + placeholders)
  src/expenses.ts             simple + itemized expenses, balances
  src/settlements.ts          payments (methods, partial/manual) + min-cash-flow suggestions
  src/invites.ts              share-link group invites
  src/quicksplit.ts           anonymous one-shot split
  src/ocr.ts                  receipt image → line items (vision)
  src/realtime.ts + GroupRoom  Durable Object live fan-out
  src/db/                     Drizzle schema + client; migrations/
web/                          React + Vite + Tailwind SPA
../../packages/owewell-core/  pure money/split math (@owewell/core)
```

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

Apply D1 migrations locally with `pnpm --filter @owewell/api db:migrate:local`. Receipt OCR needs
a vision API key set as a `wrangler secret`; without it, the rest of the app works and you itemize
by hand. See [DEPLOY.md](DEPLOY.md) for the production runbook.

## Data & database access

owewell's data lives in **Cloudflare D1** (SQLite), reached through **Drizzle** (schema in
`api/src/db/schema.ts`: `people`, `groups`, `group_members`, `expenses`, `expense_splits`,
`expense_items`, `expense_item_shares`, `settlements`, `invites`). Realtime state is *not* in D1;
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
pnpm --filter @owewell/api test        # 41 tests: groups, expenses, settlements, invites, quicksplit
pnpm --filter @owewell/core test       # the pure split/settlement math
```

The API tests run against a real local D1 (via `@cloudflare/vitest-pool-workers`), so the Drizzle
queries and migrations are exercised, not mocked.

## Observability

- **Errors + requests:** Workers Logs is enabled (`[observability]` in `wrangler.toml`), so uncaught
  throws and handled errors (via `app.onError`) are captured. Tail live with
  `pnpm --filter @owewell/api exec wrangler tail`.
- **Uptime:** `GET /health` returns `{ status: 'ok' }`, ready for a free external monitor (e.g.
  UptimeRobot).

## License

[MIT](LICENSE) © Aiden Jang
