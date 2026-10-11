# Owewell UI verification

The [design](../../DESIGN.md) gives Owewell a violet identity, a decorative receipt illustration,
a responsive group directory and quieter balance surfaces. Warm and dark themes remain available.

`packages/web/scripts/capture-ui.cjs` captures the signed-out split tool and calculated result, empty overview,
populated overview, group detail and expense sheet in both themes. It uses intercepted API fixtures in isolated
browser contexts, blocks service workers and does not write account or ledger data. It checks
1440/390/320/430/768px widths; desktop evidence uses 1440 × 900 and phone evidence uses
390 × 780 with natural scrolling. Reduced motion makes inspection repeatable.

Start a local web preview on port 34212 and run `node packages/web/scripts/capture-ui.cjs`.
`OWEWELL_PLAYWRIGHT_MODULE` and `OWEWELL_BROWSER_PATH` select an installed browser if needed.
The real browser journey in `pnpm run verify` uses its own local Worker, database and auth stub.

The existing ledger, split calculations, saved drafts, offline queue, membership and shared
Accounts redirects retain their behavior. Icons, installation metadata and sharing assets are
regenerated with the shipped warm palette. The destructive button in dark mode is adjusted
for contrast against the new surface and white text.

On October 10, desktop and phone captures were inspected for both themes, including calculated
splits and the expense sheet. The width checks found no horizontal overflow or page errors.
The final production build and unused-style check passed; the component/client suite and real
browser journey passed. The shared math suite also passed.

The combined `pnpm run verify` attempts passed their static/build gates and the other API tests,
but the assembled-ledger property test exceeded its existing five-second limit while suites ran
concurrently. It passed in isolation with that same limit; no timeout or test assertion was changed.
The full combined runner therefore is not recorded as green. The UI adds no production fixtures
and this update does not include a push or deployment.
