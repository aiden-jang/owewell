# Decisions and trade-offs

_Moved out of the README, which is the front door and was carrying the whole house._

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

|                 | limit                          | why                                                                                                                                                                    |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_LIMITER`   | 240/min across `/api/*`        | Registered **before** the auth guard, because every authenticated request costs a round trip to the shared auth service. A flood here is amplified into a flood there. |
| `SHARE_LIMITER` | 20/min on `/api/shared/:token` | The guessing target. This is what lets the token be short.                                                                                                             |

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
