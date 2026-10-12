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

## Follow-up UI polish — October 10

Balance cards now use paper surfaces and stronger amount hierarchy; mixed overview balances have
labeled tiles. Expense rows have quieter metadata and aligned amounts. Sheets have clearer selected
modes, phone grips and visible sticky Save actions. Inviting empty states and saved feedback use a
decorative receipt face, with a single nod/blink disabled by reduced motion. Dark payment controls
use contrasting ink against the pastel accent.

The refreshed captures cover both themes at desktop and phone widths, plus saved and settled states.
Checks at 320, 390, 430, 768 and 1440px found no horizontal overflow or page errors. Save remained
inside the viewport at each width. The capture helper verified that receipt animation is disabled
for reduced motion and enabled otherwise. Fixtures stay inside isolated browser contexts.

The verification run passed all static/build gates, 56 shared tests and all 170 API tests. Of the
552 web tests, one expected the previous sheet copy; its assertion was updated and all six tests
in that file then passed. No production behavior or test timeout was changed.

The real browser journey passed after giving each run a unique group name; repeated runs had
otherwise selected an older group with the same name. Final type and lint checks passed. The
combined verification invocation stopped on the old copy assertion described above; its failed
file was rerun successfully, and the browser stage was run separately. This polish is committed
locally on main and does not include a push or deployment.

The October 10 hierarchy pass moves Add expense into the activity header, away from payment controls. Log a payment has a quiet button boundary; the payment method remains labeled, and ledger titles and amounts are stronger than metadata. Group captures were inspected at desktop and phone sizes in both themes, with additional width checks at 320, 430 and 768px.

## Distinct receipt landing — October 11

The public calculator is a ruled paper receipt beside a compact numbered guide, without decorative
receipt art or feature cards. The opt-in example labels its dinner item explicitly and disappears
once a visitor starts their own bill. The real form and saved-draft behavior remain in place.

Desktop (1280 × 900) and phone (390 × 844) previews were inspected in light mode; desktop dark mode
was inspected as well. The sample divides $48 among three people into $16 shares. The component
checks cover the example calculation and protecting a bill already in progress. The browser
journey passed. The combined check run hit the existing ledger property test's five-second limit;
a focused run passed with a longer runtime allowance, without changing assertions or repository
configuration. The full combined runner is not recorded as green.

## Public welcome redesign — October 11

The rejected sidebar receipt composition is replaced with a spacious violet headline, decorative
receipt character and a centered calculator below. The introductory copy covers shared spending
beyond dinner. A direct jump reaches the tool; the optional labeled example retains its existing
draft protection. The header aligns with the wider welcome. Signed-in layouts retain their
existing structure.

`landing-redo-1280.png` and `landing-redo-390.png` record the desktop and phone views inspected
in the browser. The phone view omits decorative art to keep the calculator close to the introduction.
The example and draft restoration were exercised manually. Static checks and the production build
passed; the combined runner stopped when sandbox permissions blocked the backend test server.

The full frontend suite and real browser journey passed. The permitted backend run passed apart
from the ledger property test timing out under its default limit; that test passed alone with a
longer command-line allowance. Assertions and repository timeout settings were not changed. The
combined runner is not recorded as green.

## Amount-first calculator — October 11

Fresh bill rows lead with a larger amount field and a native Details & split options disclosure.
Described, unequal and multi-item drafts expose their details automatically. Adding items, tips
and per-item payers retains the existing math and draft representation. The empty running-total
box stays hidden, and the result emphasizes Your share before the transfer list.

The calculator was inspected at desktop and phone widths in `calculator-1280.png` and
`calculator-390.png`; `calculator-result-390.png` shows the revised result. A two-person $48
bill produced a $24 personal share and a $24 transfer in the browser. Component checks cover
the initial disclosure and existing split calculations.

Static gates, the final build, calculator component checks and the browser journey passed. The
combined runner stopped on the backend ledger property timeout; that test passed alone with a
longer command-line allowance. An earlier frontend run passed its other checks and reported a
stale assertion for the renamed share label; the final calculator checks passed after updating
that label and exercising the disclosure interaction. The combined runner is not green.
