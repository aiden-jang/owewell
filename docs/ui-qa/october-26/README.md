# October 26 review

Reviewed the working tree based on `fd7ea15`, including public loading, shared-tab
navigation, session recovery, saved drafts, production security headers and
repository maintenance. Fixtures stay inside the capture browser or isolated
test database; none are production records.

## Findings and changes

- Public calculation and shared summaries load independently of sign-in. Save
  and claim controls wait for a confirmed session, with an inline retry after a
  failure. Private addresses retain their session gate.
- Both session endpoints preserve Accounts outages as retryable failures rather
  than reporting a signed-out user.
- Shared-tab state follows its token. A previous summary or completed seat claim
  cannot replace the current tab or navigate back to the previous group.
- Draft restoration refuses malformed or duplicate rows as a whole, avoiding a
  plausible but incomplete bill. Valid drafts and missing-payer recovery retain
  their existing behavior.
- The synchronous theme script uses a same-origin file allowed by the production
  security policy. It follows the device when storage is unavailable and is
  precached with the shell. The unused display-font alias was removed.
- Patched validation and Worker tooling replace the affected dependencies.
  README, architecture, quality and deployment guidance describe the resulting
  behavior. A fresh visitor walkthrough is prepared separately.
- GitHub Actions maintenance updates share a Dependabot group, avoiding a
  separate full pipeline for each action update. Verification remains one job.

## Visual evidence

The capture script checked 320, 390, 430, 768 and 1440px widths in warm and dark
themes, including empty/populated groups, selection, sheets, saved feedback,
settled states and pending/failed session checks. The crowded shared-tab fixture
adds long names and large amounts. Checks found no horizontal overflow or page
errors; selected desktop and phone pixels were inspected.

- [Public calculator recovery](split-session-error-warm-390.png)
- [Shared tab while sign-in is pending](shared-session-pending-dark-1440.png)
- [Shared-tab recovery](shared-session-error-dark-390.png)
- [Crowded shared tab](stress-shared-dark-390.png)

## Regression evidence and limits

Before fixes, targeted checks reproduced blocked public calculation, old shared
summaries, late seat-claim navigation, false sign-outs during Accounts outages,
the blocked inline theme script and partial draft restoration. The rounding
journey now activates the actual expense-details button after submission rather
than the first matching description; its rounding and overflow assertions remain.

Production-shell browser checks map HTTPS requests to the built local Worker
responses with their security headers intact. This avoids a local certificate
exception and WebKit upgrading loopback HTTP requests. Service workers are
blocked in that fixture; it verifies initial rendering, not installed-app use.

The complete local `pnpm run verify` passed: 885 unit, component, API and arithmetic
checks plus 38 Chromium/WebKit browser cases. Dependency auditing reported no
known vulnerabilities. Repository gates, the production build and emitted-CSS
checks passed without raising budgets or test timeouts.

GitHub inspection confirmed an active default-branch rule blocking deletion and
force pushes and requiring linear history, with an empty bypass list. Direct
owner commits remain allowed. Secret scanning, push protection and CodeQL are
enabled; no open code-scanning or secret alerts were present during this review.

Real phone keyboards, installed-app recovery/update behavior, spoken screen-reader
output and an actual first-time visitor session remain manual checks. The
[visitor walkthrough](../../visitor-review.md) is a procedure, not a completed study.
