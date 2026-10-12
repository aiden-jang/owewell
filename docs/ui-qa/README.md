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

## Calculator finishing pass — October 11

Who paid? replaces the repeated payer radios. Add a tip exposes optional controls; applied tips
remain visible. Copy summary writes directly to the clipboard, keeps failure feedback visible
and takes visual priority over Save split. Inline amount errors are associated with their fields,
and the empty calculator explains how to produce a result.

The desktop, phone and small-phone dark views were inspected in `calculator-final-1280.png`,
`calculator-final-390.png`, `calculator-final-result-390.png` and
`calculator-final-dark-320.png`. The small-phone view had no horizontal overflow. The tip
disclosure opened with Enter, negative amounts showed a field error, a valid $48 bill produced
$24 shares, and Copy summary confirmed the clipboard write.

Static gates and the production build passed. The combined runner hit default timeouts in the
activity feed and backend ledger property check, so it is not recorded as green. The activity
feed, calculator and copy-action checks passed together on a focused rerun with a longer
command-line allowance; the ledger test passed alone. The real browser journey passed. No
assertions or repository timeout settings were relaxed.

## Group overview and expense entry — October 11

The latest real expense and Add expense shortcut sit immediately below the balance, ahead of
settlement detail. Tapping the latest entry opens its existing details. The simple expense sheet
keeps amount, description, payer and split controls visible, with optional date, category and note
in a disclosure. Edits and copied expenses expose their metadata.

New expenses remember the group’s last successful split method and participants on this device.
Stored IDs are checked against the roster; an empty match falls back to the current members.
Amounts and exact/percentage values are never remembered. Shares restart at one each. This
keeps the next expense from silently reusing another bill’s allocations.

Desktop and phone views were inspected in `group-entry-1280.png`, `group-entry-390.png`,
`expense-entry-1280.png` and `expense-entry-390.png`. A temporary local-only fixture rendered
the real group page and sheet without saving any data; its source was removed afterward.

Static gates, the production build, the full frontend suite and the real browser journey passed.
The combined runner stopped on the default backend ledger property timeout; that test passed
alone with a longer command-line allowance. Repository timeout settings and assertions were
not relaxed. The combined runner is not recorded as green.

## Settlement clarity — October 11

Record payment replaces Mark paid. The panel explains that payment happens in the member’s
usual app, while the ledger action only records it. The confirmation identifies sender, recipient,
amount and method. Manual entry has visible payer, recipient and method labels, a final record
summary and a sticky recording action. The successful receipt emphasizes its amount and
announces Payment recorded.

Desktop and phone confirmation/receipt views were inspected in `settlement-confirm-1280.png`,
`settlement-confirm-390.png`, `settlement-receipt-1280.png` and `settlement-receipt-390.png`.
Manual entry was inspected in `payment-entry-1280.png`, `payment-entry-390.png` and
`payment-summary-390.png`. The temporary local-only fixture exercised the real confirmation
and receipt using simulated data, then was removed. No actual payments were recorded.

Static gates and the production build passed. The full frontend suite passed, as did the
extended browser journey through payment confirmation, the receipt and a settled balance.
The combined runner stopped on the default backend ledger property timeout; that test passed
alone with a longer command-line allowance. Repository timeout settings and assertions were
not relaxed. The combined runner is not recorded as green.

## Overview clarity — October 12

Group cards label Owed to you and You owe, retain neutral no-expense and settled states,
and identify their dates as updates. Cards have a consistent minimum height. The overview
explains that an overall zero can combine opposing group balances without settling them.
New accounts have a direct first-group action; its name field has an accessible label and
creation errors announce themselves. Existing expense and payment actions remain in place.

Desktop and phone states were inspected in `dashboard-balance-1280.png`,
`dashboard-balance-390.png`, `dashboard-empty-1280.png` and `dashboard-empty-390.png`.
The browser journey uses the isolated local test ledger; the empty-account capture intercepts
only the test browser’s group-list response. No demonstration records ship with the app.

Static gates and the production build passed. The full frontend suite and the browser journey
through creation, the dashboard balance and settlement passed. The combined runner stopped
on the backend ledger property timeout; that test passed separately with a longer command-line
allowance. Repository timeout settings and assertions were not relaxed; the combined runner
is not recorded as green.

## Settings and interaction consistency — October 12

Group options focus their first item, support arrow keys and Home/End, and return focus to
the trigger on Escape. The menu has more space for archive explanations and separates deletion.
Renaming supports Enter, Escape and a saving state; repeated submissions are blocked. Member
edits and adding someone show saving feedback, preserve failed edits, label their fields and
announce add errors. Name fields respect the existing API limit. Long group and member names,
notes and large expense figures wrap safely. Invite copying announces its result. Keyboard
focus and disabled controls use the same theme-aware treatment in light and dark modes.

The isolated browser journey checks long names, keyboard navigation and a large expense with
an unbroken note. Desktop and phone evidence is saved as `group-title-light-1280.png`,
`group-title-light-390.png`, `group-options-dark-1280.png`, `group-options-dark-390.png`,
`group-rename-dark-1280.png`, `group-rename-dark-390.png`, `group-members-dark-1280.png`,
`group-members-dark-390.png`, `expense-long-dark-1280.png` and `expense-long-dark-390.png`.
These use the local test ledger; no fixture records ship in the production app.

Static gates and the production build passed. The final frontend suite and both browser
journeys passed. The combined runner stopped on the backend ledger property timeout; that
test passed separately with a longer command-line allowance. Repository timeouts and
assertions were not relaxed, and the combined runner is not recorded as green.

## Teal and ivory palette — October 12

The action palette is now deep teal, with warm ivory light surfaces and deep teal dark surfaces.
Receipt illustrations, the favicon, install icons, manifest colors, browser chrome and share
graphics use the same identity. Purple avatar and entertainment accents were replaced while
preserving readable initials and category contrast. Existing green/red balance meanings remain.
The palette data and CSS stay synchronized; existing contrast assertions were not relaxed.

Current dashboard and settings captures replace the previous palette evidence. The signed-out
calculator is also captured in `landing-teal-light-1280.png`, `landing-teal-light-390.png`,
`landing-teal-dark-1280.png` and `landing-teal-dark-390.png`. The SVG icon and generated share card
were inspected independently. Layouts, data behavior and saved theme preferences are preserved.

Static gates and the production build passed. The frontend suite, contrast checks, avatar
checks and all browser journeys passed. The combined runner stopped on the existing backend
ledger property timeout; that test passed independently with a longer command-line allowance.
Repository timeouts and assertions were not relaxed; the combined runner is not recorded as green.

## Guest saving and invite handoff — October 12

Guest saving explains the account requirement and opens shared sign-in. The editable bill
stays on this device if authentication is cancelled; it is cleared only after a successful
save. The dashboard names the pending split and offers Save split or Not now. Invite claims
explain the return to the selected name, block overlapping submissions and wrap long names.
Existing first-group guidance and queued-change behavior were reviewed and preserved.

The guest-save explanation was inspected at desktop and phone widths in
`guest-save-dark-1280.png` and `guest-save-dark-390.png`. The frontend suite and browser journeys
passed. Static gates and the production build passed; the combined runner stopped on the
backend property timeout, which passed separately with a longer command-line allowance.
The combined runner is not recorded as green.

## Recovery states — October 12

Expense entry, expense edits, copied expenses and payment forms guard unsaved input when
dismissed, when navigating back and when leaving the page. Keep editing retains the form;
Discard changes explicitly leaves it. Dismissal is blocked while a changed form submits.
Expired sign-in opens shared auth in a separate tab and keeps the original fields for retry.
Errors scroll into view above the sticky action bar. Rejected saves retain their fields, while
offline payment records remain queued and excluded from balances until reconnecting.
Invite conflicts refresh the roster; revoked links explain how to request a replacement.

Desktop and mobile evidence is in `session-recovery-1280.png`, `session-recovery-390.png`,
`discard-recovery-1280.png` and `discard-recovery-390.png`. These use the isolated local ledger.
Automated checks exercise rejected-save retry, back-navigation protection, stale claims and
offline payment replay. Shared auth itself is represented by the local stand-in service.

Static gates, type checks, lint, formatting and the production build passed. The frontend suite
and browser journeys passed, including a hit-target check that the mobile sign-in link is not
covered by the sticky action. The combined runner stopped on the known backend property
timeout; that test passed independently. Assertions and repository timeouts were not relaxed.

## Mobile entry and installed-app updates — October 12

Enter advances visible fields in expense and payment sheets rather than implicitly submitting.
Money inputs request the Next key, large amounts stay within narrow sheets and mobile member
labels have a full tap target. The browser journey checks keyboard focus, horizontal overflow
and target height at narrow widths. `mobile-input-320.png` and `mobile-input-390.png` use a
shortened viewport to approximate the space available above an on-screen keyboard. Native
iPhone and Android keyboard behavior cannot be verified in this desktop browser.

The service worker refreshes unversioned icons, metadata and HTML online, caches hashed
bundles for offline use, and leaves API and cross-origin requests outside its cache. Failed
responses cannot replace good cached entries. Return-to-app and reconnection trigger update
checks without automatically reloading entered work. Cache-policy tests run the shipped worker
with controlled network responses; they do not replace testing an installed app on a phone.

Static gates and the final production build passed. The frontend suite, cache-policy tests and
browser journeys passed. Both narrow captures were inspected; responsive amount sizing fixed
a clipped final digit that the horizontal-overflow assertion alone did not detect. The combined
runner stopped on the known backend property timeout; the property passed separately without
changing repository timeouts or assertions.

## Keyboard access and enlarged text — October 12

A separate local test account completes group creation, member addition, expense entry and
payment recording using Tab, Enter and native select keyboard controls. It checks focus after
sheets close and the announced payment status. Hidden fields in closed disclosures are excluded
from the dialog trap; summary controls are included. Nested dialogs handle their own keys.
Group options retains focus across opening Members, and first-expense saving hands focus to
the replacement Add expense action when the empty-state control disappears. Saving controls
expose busy state and polite status announcements.

`accessibility-text-200-1280.png` and `accessibility-text-200-640.png` double the root text size
and rem-based spacing, with no horizontal overflow at either width. This exercises enlarged
text and reflow, rather than native browser zoom controls. Accessibility roles, labels and
keyboard behavior were checked in Chromium; spoken VoiceOver and NVDA output is not available
in this environment and remains a device check.

The matching `accessibility-entry-200` captures inspect the expense sheet at both widths.
The settled recap now chooses columns from available space and text size, keeping its amounts
readable at enlarged text sizes. Desktop and narrow captures were inspected. Static checks,
the production build, frontend tests and browser journeys passed. The combined verification
runner hit the backend property timeout; the unchanged property passed separately.

## Payment records, invites and crowded groups — October 12

The payment form, settle-up panel and confirmation already explained that owewell does not send
money. The saved receipt now makes that distinction explicit too. Invite copy distinguishes
viewing from connecting an existing person and balances to a signed-in account.

The capture script’s optional `OWEWELL_UI_STRESS=1` fixture uses a crowded group, long unbroken
names, a long group title and large amounts. `stress-group` and `stress-shared` captures were
inspected in both themes at desktop and phone widths, with additional narrow overflow checks.
Names wrap instead of forcing controls out of their rows; shared totals scale without shortening
the number. All fixture data stays inside the browser capture script. Native phone keyboards,
installed-app offline recovery and spoken screen-reader behavior still require a real device;
desktop browser emulation cannot verify them.

Static gates, the production build and frontend tests passed. Browser journeys passed, with
the keyboard journey retried separately after the first run closed its member sheet before
the input-reset assertion. Updated receipt and invite captures were inspected at enlarged text
sizes. The combined runner stopped on the existing backend ledger-property timeout; the
unchanged property passed independently without changing repository timeouts or assertions.

## Visual hierarchy — October 12

The overview directory now separates group titles, balances and update details inside spacious
cards. Balance numerals use quieter weight, with a larger receipt mark and finer accent rule.
The group’s expense action has a dashed paper edge; the ledger has a visible Activity heading
and tighter spacing. Card hover movement is limited to hover-capable devices without reduced
motion. Existing data, selection controls, form behavior and explicit balance labels remain.

Desktop and phone overview and group captures were inspected in both palettes, alongside
narrow-width overflow checks. The optional stress fixture checks the redesigned directory
with long names and large amounts.

Selection-mode captures include a selected group and the fixed bulk-action bar. Stress
inspection caught a subtotal wrapping before its cents; wide amounts now take a wider tile
on phones. Static gates, the production build and frontend tests passed. The combined runner
stopped on the known backend ledger-property timeout; the unchanged property passed separately
without modifying repository timeouts or assertions.

The keyboard journey and the remaining group journeys passed in separate runs. The initial
combined browser attempts hit a local Wrangler proxy crash between specs; restarting and
separating the specs verified the flows without changing their assertions.
