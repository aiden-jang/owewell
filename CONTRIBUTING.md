# Contributing

Use the supported Node and pinned pnpm versions described in [README](README.md).
Install with the frozen lockfile and apply local D1 migrations before starting
manual development. [Architecture](docs/architecture.md), [Design](DESIGN.md) and
[repository conventions](CONVENTIONS.md) describe the boundaries to preserve.

## Changes and verification

Keep an interface change connected to the problem it solves. Preserve keyboard
access, reduced motion, saved drafts, offline recovery and the distinction between
recording a payment and sending money. Reuse the shared allocation logic; saved
ledger amounts and shares are computed on the server.

Run `pnpm run verify` before reporting work complete. Add regressions that expose
an actual failure, confirm they fail before the fix and keep existing assertions.
Do not change production data while testing. Use the isolated browser ledger for
integration checks and the capture script's browser-only fixtures for visual work.
See [Quality checks](docs/quality.md) for setup and coverage.

If a schema change is required, inspect the current migrations and
[migration guidance](packages/api/migrations/README.md). A source refactor does not
justify changing migration history. Keep wire timestamps and database timestamps
at their respective boundaries.

## Review and commits

Use Conventional Commits without a scope:

```text
fix: retain the current ledger after a delayed response
refactor: separate group actions from page composition
```

Describe the problem, resulting behavior, validation and any unavailable checks.
Include relevant desktop and phone evidence for visible changes. Keep new captures
focused and label their revision; historical evidence remains historical.

Documentation describes the current system. Comments explain constraints that
would otherwise be easy to violate. Remove descriptions of previous implementations
and moved responsibilities; Git history supplies that context.
