# Quality checks

Use the Node ranges and pnpm version in [package.json](../package.json). The latest
Node 22 release matches CI. `corepack pnpm` selects the pinned package manager;
enable its shim so nested workspace calls to `pnpm` use that version too.

## Complete verification

```sh
pnpm --filter @owewell/web exec playwright install chromium webkit
pnpm run verify
```

CI installs browser system dependencies as well. Verification checks gate parity,
module size/state, CSS variables, comments, docs, unused code, types, lint,
formatting, the build, emitted CSS, unit/DOM behavior and real browser tasks.
Each gate can run independently through its named root script.

API tests run in the Cloudflare Worker runtime with real local D1 and the
production migrations. The assembled-ledger scenarios each retain their seeded
sequence and per-step zero-net assertion, with separate cases for failure reporting
and runtime budgets. Test timeouts and accounting assertions remain unchanged.

Shared-package tests cover arithmetic. Web tests cover pure presentation logic and
DOM interactions, including drafts, sheets, sharing, stale requests and outbox
replay. The core package contains wire types and constants; typechecking validates
that contract.

## Browser integration

```sh
pnpm run e2e
pnpm --filter @owewell/web run e2e --grep keyboard
```

The suite starts fake auth, the real API Worker and the web server on the dedicated
loopback ports in `packages/web/e2e/servers.ts`,
with migrations applied to `.wrangler/e2e-state`. The API uses a different port from
manual development, and browser tasks wait for its HTTP health endpoint. The web
proxy receives the test API port explicitly. Test state stays separate from development
state. A signed-in identity belongs to each browser scenario.
Each sign-in uses a fresh test account so groups left by earlier runs cannot change a scenario.
Each scenario also uses an independent local IP budget while native rate limiting
remains active. Auth is the stand-in; the group data, API and balances are real local results.

Keep these ports free and stop manual development servers before the suite. Tests
must not reuse a server pointed at the development database or production auth.
Failed tests retain traces; generated reports, screenshots and local Worker state
are excluded from repository scans and Git.

Journeys cover group creation, membership, expenses, payment recording, offline
replay, recovery and signed-out calculation. Delayed session checks must not block
public calculation or shared summaries, enable premature account actions, or
redirect a private address. Session retries retain the current bill. Shared-tab
DOM regressions cover delayed summaries and seat claims after a link changes.
Production-shell checks load the built Worker responses over an HTTPS fixture with
their security policy intact, holding the app bundle to verify the early palette.
Draft tests reject partial recovery and duplicate row IDs.
Keyboard checks include sheets,
focus return and enlarged text. Browser tests run in Chromium and WebKit. WebKit is an engine check, not a
physical iPhone Safari check. On macOS, the keyboard journey uses
[Apple’s Option-Tab navigation](https://support.apple.com/en-gb/guide/safari/cpsh003/mac)
to reach clickable controls.

## Visual review

```sh
pnpm run dev:web
# In a separate terminal:
pnpm --filter @owewell/web run capture:ui
```

The capture script intercepts API responses inside its own browser. Fixtures never
enter D1 or ship with the app. It reviews warm/dark layouts, forms, recovery and
narrow viewports; `OWEWELL_UI_STRESS=1` enables long names, large totals and crowded
rosters. Review pixels as well as overflow assertions. Keep generated capture sets
local and summarize relevant findings in the change description. `OWEWELL_UI_OUTPUT` chooses
a separate capture directory and `OWEWELL_UI_URL` selects a running preview.

A viewport resize cannot establish native phone-keyboard behavior, installed-app
recovery, device performance or spoken screen-reader output. Those remain manual
checks on physical devices. Explicitly report unavailable checks.

Dependency auditing is part of the local and CI gates. Worker tests use the maintained
Cloudflare Vitest plugin and explicitly clear ledger rows between tests; files run serially
so their resets cannot erase another test’s fixtures. DOM tests bound worker concurrency
without changing test deadlines.

CI keeps verification in one job and deploys the resulting client artifact.
Dependabot groups routine package updates and GitHub Actions updates separately,
reducing duplicate full runs for related maintenance changes.

## Review artifacts

Keep generated screenshot sets, videos, traces and run reports in ignored
`test-results/` output or a temporary local directory. CI artifacts should expire.
Commit authored design references and a small curated set of README images only;
keep runtime and installation assets separate. Earlier audit records remain in Git
history. Use synthetic data and remove private information from shared evidence.
