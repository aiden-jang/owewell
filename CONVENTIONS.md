# Repository conventions

`AGENTS.md` and `CLAUDE.md` link here so repository guidance has one source.
Setup and commit conventions are in [Contributing](CONTRIBUTING.md).

## Verification

Run `pnpm run verify` before reporting a change complete. It includes browser
journeys; CI runs the same gates in the same order. Use the pinned package manager
and supported Node runtime described in [README](README.md).

- `gates` requires real scripts and matching verification order. Always use
  `pnpm run <name>`; a bare command may resolve to a package-manager builtin.
- `size` bounds module length and component state, including gate implementations.
  Do not split a file solely to pass; each module needs a coherent responsibility.
- `comments` limits comment density and detects comments stranded by moves.
  Never raise its ceilings to retain prose.
- `check:docs` validates documented paths, script names, routes, symbols and links.
- `css-vars` requires custom properties to be declared; fallbacks do not make an
  undeclared property legitimate.
- `knip` checks unused files, exports and dependencies.
- `dead-classes` follows the build because it checks the CSS Tailwind actually emitted.

Confirm a scan examined the intended files before drawing conclusions. An empty
or implausibly clean result can indicate a bad glob or wrong working directory.
New checks must cover their own implementation. Introduce a failure, observe the
check fail, restore the original and confirm restoration left no temporary changes.

## Ledger invariants

The API accepts participants and a method, computes the shares itself and checks
membership for the payer, each participant and every item payer. Itemized totals
come from items plus tax and tip, so saved totals and shares cannot disagree.

The assembled ledger must net to zero. `simplifyDebts` rejects a broken invariant
rather than suggesting payments over corrupt balances. Itemized participant debits
and payer credits are computed separately and must conserve the same total.

A recorded payment locks existing expense history; later spending remains allowed.
Partial and over payments are intentional. Do not cap a payment at the suggested
amount. The greedy settlement algorithm produces a short list of transfers rather
than guaranteeing a mathematical minimum.

`@owewell/core` is the JSON wire contract and uses string timestamps. Database and
service types use dates. Preserve that boundary instead of merging their types.
ID collections and bulk inserts must fit D1's statement parameter budget. Use
`inIds` and `insertRows` rather than expanding large collections into bound lists.
Keep batch writes transactional.

The server is authoritative for group balances; queued client input is not a
confirmed split or balance.

## Tests and evidence

Every API test starts with the production D1 migrations. Stub outbound calls with
`vi.stubGlobal('fetch', …)` because the Worker makes them inside the test isolate.
Keep seeded ledger scenarios independently replayable and preserve their per-step
conservation assertions. Do not relax assertions or timeouts to obtain a pass.

Browser journeys use fake auth because the Worker checks the session server-side.
Use a caller identity for each scenario and the isolated D1 directory. Refuse to
reuse development servers for verification. Capture fixtures belong to the capture
script's browser; they must not enter production source or data.

Review changed interfaces at desktop and phone widths, including long names,
large amounts, keyboard focus, themes and reduced motion. Automated checks cannot
establish physical-device behavior or spoken screen-reader output. State limits
explicitly. [Quality checks](docs/quality.md) describes setup and coverage.

## Comments and documentation

Comments explain non-obvious constraints or decisions. Keep inline comments short;
a longer explanation must record something a reader would otherwise rediscover.
Remove descriptions of old implementations, successive revisions and obsolete
responsibilities. Re-read comments near the seams after moving code.

Do not put live test totals, file lengths or gate totals in documentation. Let the
checks print current measurements. Describe current behavior; Git history retains
earlier review evidence.

Keep generated review output out of Git; follow the [artifact policy](docs/quality.md#review-artifacts).
