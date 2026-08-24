# Migrations are written by hand

`wrangler d1 migrations apply` reads this directory in filename order, and that is the only thing
that decides what runs. Add a numbered `.sql` file; `pnpm run deploy` applies pending ones before it
ships the code.

## Why there is no `drizzle-kit generate`

There was, and it is a trap now. `meta/_journal.json` stops at `0011_recurring_rules` and the newest
snapshot is `0010_snapshot.json`, because `0012`–`0020` were written by hand and never registered.
Drizzle diffs `schema.ts` against its newest snapshot, so running it today would emit one migration
re-doing nine that are already applied — and a feature it still thinks exists (`0014` dropped the
recurring rules that `0011` added).

The `meta/` directory is kept only so the lineage is readable. Nothing consumes it.

`schema.ts` is still the single description of the shape: write the migration, then make the schema
match it. They are checked against each other by the tests, which run against a real D1 built from
these files (see `vitest.config.ts`, which reads this directory).
