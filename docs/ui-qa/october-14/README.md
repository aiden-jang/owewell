# Repository and interface review — October 14, 2026

This review covers the complete repository cleanup and the resulting interface.
Historical reviews describe their own revisions; these captures use the final
production build with browser-only fixtures, without writing to D1.

## Changes reviewed

- Group navigation clears the prior ledger and invite while the next group loads.
  Delayed results and errors cannot overwrite the active surface or newer requests.
- Failed sign-in checks offer a retry and a public calculator path, without
  claiming that an unavailable session check established a signed-out session.
- Secondary text meets normal-text contrast on its supported surfaces. Archived
  cards retain readable names and amounts, using a dashed border for distinction.
- Page composition delegates draft editing, group actions, card presentation,
  activity rows and expense-editor handoffs to focused modules.
- Large histories, rosters and itemized receipts use bounded database predicates
  and transactional inserts. Regression coverage preserves membership isolation,
  exact balances, safe quoted/empty ID filters and rollback on a batch conflict.
- Source checks include gate implementations. Documented links, headings and exact
  file paths are checked, alongside the existing routes, names and script guards.

The [dashboard](dashboard-warm-1440.png), [archived phone cards](archived-warm-390.png)
and [sign-in recovery](session-error-warm-390.png) retain focused visual evidence.
The review also covered the calculator, group detail, public shares, selection
mode, simple/itemized expense entry, payments, successful receipts and settled recaps.

## Validation

The complete verification command passed. Seeded ledger scenarios keep their
original operations and per-step conservation assertions, using independent test
cases rather than an enlarged timeout. Browser callers have separate local IP
budgets while native rate limiting remains enabled. Tests refuse to reuse manual
servers or development state.

Chromium and WebKit journeys exercise the real local Worker and D1. The production
visual review covered both themes at desktop, tablet and narrow-phone widths,
including enlarged text in the keyboard journey. The reviewed production states
had no horizontal page overflow or page errors. A temporary Axe audit found no
WCAG A/AA violations after the contrast corrections. Assertions and timeouts were
not relaxed. Temporary failures demonstrated the lifecycle, session, contrast and
repository-check regressions, then their originals were restored.

## Limits

Viewport emulation and WebKit do not establish physical iPhone Safari behavior.
Native phone keyboards, installed-app recovery, spoken screen-reader output and
actual device performance still require physical-device review. Shared sign-in
is represented by fake auth in integration tests. Production deployment was
outside this review.

See [Quality checks](../../quality.md) for repeatable commands and coverage.
