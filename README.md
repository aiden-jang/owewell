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
        ║   owewell Worker (Hono)  — one origin            ║
        ║   /api/*  API        +   app.all('*') → SPA      ║
        ║      │                                           ║
        ║      ├─ getSessionUser → accounts.aidenjang      ║  (optional; quick split is anonymous)
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

## Decisions worth explaining

**Money is integer cents, everywhere.** Floats and money don't mix: `0.1 + 0.2` alone should end
the debate. Every amount is an integer number of cents from the API boundary through the database.
The split math also has to decide who eats the leftover cent when a total doesn't divide evenly;
doing that on floats would silently lose or invent money.

**The split math is a pure package (`@owewell/shared`), tested without any I/O.** Even splits,
weighted splits, itemized allocation, remainder distribution, balance netting, and the
minimum-cash-flow settlement suggestion all live in a dependency-free package. The Worker is a thin
shell that reads D1, calls it, and writes back. The rules I most want to be _correct_ are the ones
furthest from the network — and because the browser imports the same package, the quick-split
preview and the saved expense cannot disagree.

**The odd cent is assigned deterministically, from a seed both sides can derive.** Largest-remainder
allocation decides who absorbs the extra penny, and the tie-break normally comes from the expense
id. Quick split has to show the split _before_ the expense exists, so it passes an explicit seed;
otherwise the preview shows one arrangement and the save produces another.

**D1 for the ledger, a Durable Object for the live feed.** The data is relational, so D1 + Drizzle
is the natural home. Realtime is a different shape (a short-lived fan-out to whoever's looking at
one group), so each group gets a `GroupRoom` Durable Object that holds no durable state and just
relays "something changed." Hibernation WebSockets mean an idle room costs nothing. _Why not push
everything through the DO?_ Durable relational data in a single-threaded object is the wrong tool;
D1 is the source of truth and the DO is a notification bus.

**Writes survive a dead connection.** The app gets used in restaurants, which is where phones have
one bar. A write that can't reach the server goes into a localStorage outbox and is replayed later.
Each kind is queued on its own terms: a create carries an idempotency key so a replay is recognised
rather than duplicated, a delete needs none (deleting twice is deleting once), and an edit carries
the version it was written against, so one that would erase somebody else's change comes back as a
question instead of quietly winning. Not the Background Sync API — Safari doesn't implement it.

**Edits are versioned, and a conflict is a question.** `expectedVersion` on an edit lets the server
refuse one written against a row that has since moved. The client then asks the person, and if they
choose their own version it re-sends _without_ the version — otherwise the retry conflicts with the
change it was just told about, forever.

**Deletion is soft, so undo is a flag flip.** The same row comes back with the same id and the same
splits, down to which person absorbed the odd cent. A re-create would move a penny between two
people. That's also why there's no confirm dialog on delete: a confirm asks you to predict a mistake
you haven't made yet, and everybody clicks through it.

**Accounts are optional.** Quick split works signed out because the highest-friction moment is the
one where you just want a number at the table. `/api/me` returns `{ user: null }` rather than a
401, so the client treats signed-out as a normal state rather than an error.

**Placeholders are first-class.** Real life is "me, my roommate, and the two friends who'll Venmo me
later." A placeholder is just a name. A share link lets one of them claim that seat and become a
real member; the seat id travels through sign-in in the return URL, because a full-page redirect
loses anything held in memory.

**Share links are revocable.** The owner can mint a replacement — which stops every copy of the old
link resolving — or turn public access off entirely. Members keep their access either way.

**One currency, on purpose.** A per-group currency setting was removed: it relabelled amounts
without converting them, which is worse than not offering it.

**Two themes, and the palette is data.** `warm` and `dark`, following `prefers-color-scheme` until
someone chooses. Every colour lives in `lib/contrast.ts` as well as in `index.css`, and a test
parses the stylesheet to assert the two copies agree — because a colour that fails contrast is a
real defect, and defects deserve tests. The same tests hold the bars: 4.5:1 for body text, 3:1 for
UI shapes, and the avatar discs capped so they don't out-saturate the money.

### The API prefix

The API is at `/api/*`. It used to be `/owewell/*`, which said the app's name twice on its own
subdomain (`owewell.aidenjang.com/owewell/groups/…`). The prefix itself is load-bearing — one
Worker serves both the SPA and the API from one origin, so something has to separate an API call
from a page request — but the name was not.

`/owewell` still answers. Both prefixes mount the same sub-app, so there is nothing to keep in
step, and a browser holding a cached bundle or an old service worker keeps working. It can be
deleted once nobody is on the old bundle.

Share links never contained the prefix (they are `/s/:token`, a client route), so none of this
touched a link anyone had been sent.

### Rate limiting, and why the share token is short

The share link is the only way to read a group without signing in, so it is the only URL worth
guessing at. Two per-IP limits, both native Cloudflare bindings checked at the edge:

| | limit | why |
|---|---|---|
| `API_LIMITER` | 240/min across `/api/*` | Registered **before** the auth guard, because every authenticated request costs a round trip to the shared auth service. A flood here is amplified into a flood there. |
| `SHARE_LIMITER` | 20/min on `/api/shared/:token` | The guessing target. This is what lets the token be short. |

Both degrade **open** when the binding is absent — local `wrangler dev` doesn't provide one, and a
limiter that closed instead would make the app unusable offline in a way that looks like a bug in
whatever you were building at the time.

Share tokens are 14 Crockford base32 characters (~70 bits, no `I`/`L`/`O`/`U`). They were 64 hex
characters, which was 256 bits doing the job of a rate limit that didn't exist. Length alone caps
nothing: a guesser with unlimited attempts eventually gets there, and one with 20 attempts a minute
never does. Old tokens still resolve, so links already in people's messages keep working.

`/health` is deliberately outside both, or an uptime monitor would trip the limit.

---

## Trade-offs

- **Settlement suggests, it doesn't move money.** owewell computes the fewest transfers and tags
  the method; the actual payment happens in Venmo/cash/etc. Integrating a payments API is a whole
  different trust-and-compliance surface I deliberately stayed out of.
- **Realtime is a "refetch" nudge, not a CRDT.** The DO broadcasts "group changed" and clients
  refetch, rather than syncing granular ops. Simple and correct for this scale; a busy shared group
  would want diffed updates.
- **The outbox is per-device, not per-account.** A write queued on your phone replays from your
  phone. Syncing the queue itself would need a server-side store, which is most of the way to
  building the thing the queue exists to avoid.
- **`expense.date` is stored as UTC midnight.** It's a calendar day, not an instant, so the client
  formats it in UTC and never builds a `Date` from the stored value. Storing a plain `YYYY-MM-DD`
  would be cleaner; it isn't worth a migration.
- **The PWA manifest hardcodes the warm palette.** Manifests can't respond to colour scheme, so a
  dark-mode user gets a cream splash screen. Platform limit, not a decision.

## Project layout

```
packages/
  api/       owewell Worker (Hono)
    src/index.ts        routes: /api/* API (+ /owewell alias) + SPA fallback; harden()
    src/groups.ts       groups, membership, share tokens
    src/members.ts      real accounts + placeholders, seat claiming
    src/expenses.ts     simple + itemized expenses, revisions, balances
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

Apply D1 migrations locally with `pnpm --filter @owewell/api db:migrate:local`. See
[DEPLOY.md](DEPLOY.md) for the production runbook, including the optional extras that are built but
not switched on.

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
pnpm -r test    # 749 tests: 147 API, 546 web, 56 shared
```

Three registers, deliberately:

- **`shared`** — the arithmetic, with no I/O at all. Splits, remainders, netting, settlement.
- **`api`** — real routes against a real local D1 via `@cloudflare/vitest-pool-workers`, so the
  Drizzle queries and the migrations are exercised rather than mocked.
- **`web`** — mostly behaviour, not markup: the outbox drain, the focus trap, the session's
  person-id remapping, the forms' reconciliation guards, the realtime socket's reconnect.

Four things the suite does that are worth copying:

**Authorisation is tested as a property, not per route.** Authentication is middleware and covers
everything; authorisation is a hand-written `requireMembership(...)` inside each of 26 service
functions, so a new one that forgets it compiles, lints, and passes every other test. One suite
walks every mutation and every group read as a signed-in stranger and asserts each is refused —
including that the refusal is identical for a group that does not exist, so ids stay unguessable.
The same checks are asserted on the _edit_ paths, not just create: an edit rewrites money already
in the ledger.

**It asserts the palette against the stylesheet.** `contrast.test.ts` parses `index.css` and checks
every colour matches its TypeScript copy, then measures the contrast ratios. A colour regression is
otherwise invisible until somebody complains.

**It is pinned to `America/New_York`.** An expense's date is a calendar day stored at UTC midnight,
so every bug in handling it is invisible from UTC — and CI runs in UTC. Pinning one zone means the
date tests assert the same thing everywhere, and the zone they assert in is one real users are in.

**The API runs as two vitest projects.** The D1 tests need isolated storage: each starts from the
post-migration snapshot and rolls its own writes back. The Durable Object tests cannot have it — a
room holding an accepted WebSocket cannot be snapshotted, and the pool fails with "Isolated storage
failed" without naming the cause. Turning it off globally would have quietly let the D1 tests
contaminate each other, so realtime gets its own project instead.

CI runs `typecheck`, `lint`, `format:check`, `build`, `dead-classes` and `test`, in that order.
`dead-classes` diffs the class names in the source against the CSS the build actually emitted: a
Tailwind class that never gets generated produces no CSS and no error, and it once caught a
`@custom-variant` shorthand that silently deleted all 114 hover styles while typecheck, lint and the
whole suite stayed green. It runs after `build` because it needs the emitted stylesheet.

## Talking about this

**The short version.** Split bills with a group, see who owes whom live, and settle up in the fewest
payments. Money is integer cents everywhere.

**The shape.** Groups, expenses and balances live in D1 through Drizzle. A Durable Object per group
pushes changes to everyone watching, so two people entering expenses at a restaurant table see each
other's as they happen. The settle-up step takes the debt graph and reduces it to a minimal set of
transfers, so eight people don't make twenty-eight payments.

**The call I'd defend.** Integer cents from end to end, never floats. This sounds like pedantry
until you split $10 three ways: floats give you three payments of 3.3333333333333335 and a balance
that never quite reaches zero. Cents means the remainder is one cent and I have to decide who gets
it, which is a product question I'd rather answer on purpose than discover in a rounding error.

**The second one I'd defend.** The pure package. It isn't tidiness — it's that the browser and the
Worker import the same `allocateCents`, so a quick-split preview and the expense it saves are
computed by one implementation. The first version had the preview doing its own arithmetic, and on
an uneven bill it showed a number that wasn't the number that got saved.

**The one I got wrong.** Every expense showed the wrong date for anyone west of UTC. An
`<input type="date">` gives `"2026-08-24"` in your own calendar; the API did `new Date(...)` on it,
which is UTC midnight; the client formatted that instant in local time and landed on the day before.
Since the form defaults to today, adding an expense in New York dated it yesterday. Nothing threw,
no test failed, and the edit form was quietly right the whole time because it read `date.slice(0, 10)`
instead of parsing. Two things came out of it: dates are a calendar day and are read as strings, and
the test suite is pinned to a non-UTC zone so the class of bug can't hide again.

**What I'd tell you about testing.** I try to make a test fail on purpose before I trust it, and it
keeps changing the outcome. A test asserting the outbox reuses its idempotency key passed against a
deliberately broken retry, because the UUID stub returned the same value every call — it couldn't
tell a reused id from a fresh one. A focus-trap test covered tabbing forward out of a dialog but not
backward, which only showed up by breaking each guard one at a time instead of all at once. And a
sabotage that breaks the file's syntax makes vitest report "Tests: no tests", which reads exactly
like a pass if you only skim the summary.

**What breaks first.** D1 write throughput on a single very active group, since every expense is a
write and the Durable Object fans out the change. Realistic groups are under twenty people, so this
is theoretical, but it's the first thing that would bend.

**What I'd change.** The revision log. Editing an expense used to overwrite it in place, so a $40
dinner could become $80 with nothing but a moved balance to show for it. There's a log now, but it
went in late. It should have been written with the edit path, because "who changed this" is the
first question anyone asks when a number looks wrong.

**The thing I keep relearning.** Most of the real bugs in this app were found by putting hostile
content into a component and measuring it, not by reading the code. Long names and four-figure
amounts at 375px found a members list rendering "Tomas" as "T…", a settle-up row that pushed the
amount five lines below the button that records it, and a `<select>` whose width was set by its
longest option. All of them survived review, twice, because on my own data they looked fine.

## Observability

- **Errors + requests:** Workers Logs is enabled (`[observability]` in `wrangler.toml`), so uncaught
  throws and handled errors (via `app.onError`) are captured. Tail live with
  `pnpm --filter @owewell/api exec wrangler tail`.
- **Uptime:** `GET /health` returns `{ status: 'ok' }`, ready for a free external monitor (e.g.
  UptimeRobot).

## License

[MIT](LICENSE) © Aiden Jang
