# Architecture

## Runtime and package boundaries

One Cloudflare Worker serves the API and the built SPA. The API lives under
`/api`; `/owewell` remains an alias for cached clients. Vite proxies both prefixes
in development. The Worker serves client routes through its assets binding.

`packages/core` owns JSON wire contracts and shared vocabulary. Its timestamps are
strings; database/service types may use dates. `packages/shared` owns integer-cent
allocation and greedy settlement arithmetic, without I/O. The API is the authority
for group balances; only the anonymous calculator computes a preview in the browser.

## Server

`packages/api/src/index.ts` orders security headers, cache policy, rate limiting,
public endpoints, authentication, route registration and SPA fallback.
`groupRoutes.ts` registers group and invite management on the authenticated router.
`apiErrors.ts` maps service errors into the existing response contracts. The
extraction preserves middleware ordering and both API aliases.

Ledger services validate membership, compute shares and use Drizzle over D1.
ID collection filters use a bound JSON rowset through `db/ids.ts`, keeping large
histories within D1's statement parameter budget. `db/rows.ts` splits bulk inserts
into bounded statements within one database batch transaction. Empty ID lists,
quoted IDs and database subqueries retain their filtering semantics. This follows
[D1's documented JSON-array predicates](https://developers.cloudflare.com/d1/sql-api/query-json/).

Simple and itemized expense writes share guards; revisions, expected versions and
client IDs preserve corrections and retry behavior. The production schema is in
`packages/api/src/db/schema.ts`; test setup applies the same migrations as Wrangler.

The assembled ledger must net to zero. Recorded payments lock existing expense
history, while later spending remains allowed. Payments may be partial or exceed
a suggested amount. Itemized payer credits and participant debits must agree.
These rules are recorded in [Repository conventions](../CONVENTIONS.md).

The Accounts service owns users and sessions. The Worker validates the session
and resolves an app-local person before authenticated routes. Placeholder seats
can be claimed through a share token. Public summaries remain read-only.

`GroupRoom` is a Durable Object notification bus. Authorized sockets receive a
change notice; clients refetch the ledger. D1 remains the durable source of truth.
Native per-IP rate-limit bindings run before expensive work and degrade open when
absent from a runtime or request. Browser tests keep native bindings active and
use independent caller IPs.

## Interface

Pages compose focused features. Dashboard cards, group creation and pending split
saving have their own components. Group detail uses a keyed content instance so
switching groups discards the old group's sheets, filters and payment receipt.
`useGroupActions` owns confirmations and writes; `ExpenseEditorSheets` owns the
details-to-edit/duplicate handoff. Activity filters stay in the feed while
`ActivityRows` renders confirmed expenses and payments.

`useQuickSplitDraft` owns editable bill state, draft recovery, participant changes
and generated tips. `computeQuickSplit` uses the shared arithmetic for preview;
`QuickSplitResult` renders the shares and transfers. Saving sends inputs to the
server, which computes the saved allocations independently using the same seeds.

`useGroupLedger` fetches the group, balances, expenses, payments and suggestions.
It clears previous group data on a route change. `useAsyncScope` prevents delayed
responses, errors or copy confirmations from applying to another surface or
superseding newer requests. Successful same-group responses still provide payment receipt snapshots when a
newer realtime read overtakes them, while only the latest request updates the
screen. Saved group changes invalidate older reads; an initial refresh failure
offers recovery rather than leaving a loading screen. Invite links, sharing and
session checks use the same lifecycle rule. Failed
session checks expose a retry state rather than claiming the visitor is signed out.

`useDialogFocus` owns custom-dialog keyboard behavior, focus restoration and
background scroll locking. `Sheet` owns change protection and page-navigation
handoff. Native disclosures keep optional fields reachable without overwhelming
expense entry. Shared theme data and CSS are checked for contrast consistency.

## Recovery and assets

Working calculator drafts and queued writes live on the current device. Outbox
replay uses idempotency keys for creates and payments, versions for edits and
idempotent deletes. Pending rows and notices explain why confirmed balances have
not yet incorporated the local change. Realtime and reconnect events refetch data.

The service worker handles the app shell and fingerprinted static assets, excluding
API and cross-origin requests. Unversioned resources revalidate online; update
checks avoid replacing entered work with an automatic reload.

## Verification and delivery

[Quality checks](quality.md) describes the production-schema API tests, DOM tests,
local browser journey and visual fixtures. CI and `pnpm run verify` share gate
order. Repository checks cover module size, comments, documented paths and names,
unused code, CSS variables and emitted utility classes.

The existing deployment job runs after CI succeeds on `main`. This cleanup does
not perform deployment or change that workflow. [Deployment](../DEPLOY.md) covers
operational commands and the migration-before-code ordering.
