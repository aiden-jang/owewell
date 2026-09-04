# Working in owewell

How this repo expects to be worked in. Personal working style (commits, planning,
how to explain things) lives in the global `~/.claude/CLAUDE.md`.

The first half is engineering standards that apply to any codebase. The second half is owewell
itself: what holds the money up, its deliberate oddities, and the traps it has actually hit.

## Do not trust your own measurements

Most false statements come from scans that measured nothing, not from misreading code. Real cases:
a glob with `{src,test}` braces matched zero files, so a coverage sweep compared against an empty
string and called every module untested; a `cd` inside a backgrounded command did not apply, so
three "stability runs" ran nothing; a coverage tool reported 0% because it could not instrument the
runtime; a script name silently resolved to an npm builtin, so a check reported green for a day
without ever executing.

So: an impossibly clean result means suspect the scan first. And **green is not proof unless you
have seen that check fail** — break the thing it guards, watch it go red, then believe it.

## Writing a new check

- It has to cover its own source, or the checks stop being checked.
- It has to cover every place the failure can appear, not just where you first saw it.
- Exclude test files from source scans: tests mount throwaway routes and declare throwaway types.
- Prove it fails before trusting it, and prove a failure leaves the tree clean.
- Always `pnpm run <name>`, and never name a script after an npm command. A script called `docs` is
  shadowed by npm's own `docs`, which exits 0 without running anything.

## Numbers in prose

Do not write live counts into docs: test totals, check totals, file lengths. Nothing verifies them
and they go stale silently. Say what a thing is and let the check print the number. Describing a
past change is different, and fine.

## Comments

- Keep an inline comment to a line or two. A longer block has to earn it by recording something a
  reader would otherwise rediscover the hard way: a trap that has bitten, a rule worth having, a
  constraint that fails silently. Well over a hundred blocks here run longer than that and they are
  mostly the good ones, so length is not the test. "Why, not what" is.
- Never explain a refactor, or what the code used to do. A reader never saw that version.
- A comment that logs successive changes is a changelog. Git has it, and the log drifts out of step
  with the value it describes.
- After moving code, re-read every comment near the seam. A move strands them on the wrong function.
- Never raise the comment ceiling to fit prose you want to keep. Trim instead; no script can
  enforce that about itself. The ceiling is a share of the code rather than a line count precisely
  so that adding a module is not a reason to touch it.

---

# owewell specifics

Everything below was checked against the code, not recalled. If you change one of these, change
this file in the same commit.

## The gates

`pnpm run verify` and CI run the same list, and `gates` is what keeps them the same list. The
homemade ones:

- `gates` — every step of verify, deploy and ci.yml names a real script, and none is shadowed by a
  pnpm command of the same name.
- `size` — a line and `useState` ceiling per file.
- `comments` — capped as a share of the code, not a line count.
- `check:docs` — the paths, script names, routes and symbols the docs name all exist.
- `dead-classes` — must run after the build, because it diffs against the CSS Tailwind emitted.

`ALREADY_OVER` in `check-size.mjs` holds the files still being decomposed, at the size they were
when the gate went in. Shrink an entry as the file shrinks and delete it when the file is under the
ceiling; leaving one behind after the fact is how a ceiling stops meaning anything.

## What holds the money up

The API never accepts a split. `createExpense` takes participants and a method and computes the
shares itself, and an itemized expense derives its own total from its items plus tax and tip, so
what is stored cannot disagree with what it adds up to. Membership is checked on the payer, on every
participant and on every item payer.

The ledger has to net to zero. `simplifyDebts` throws on a set that does not, so a stray cent stops
the settle-up screen working rather than making it slightly wrong. Every split function has a
property test saying it conserves; `test/ledger-nets-to-zero.test.ts` is the one that checks the
assembled result, once expenses, receipts, settlements and deletions are mixed together.

The two halves of an itemized expense are computed by different functions: `computeItemizedSplit`
debits the participants and is stored, `computeItemizedPayers` credits the payers and is recomputed
on every balance read. They must agree, and only their own tests know it.

## Deliberate oddities

- A recorded payment locks the group's _history_: no editing or deleting an expense a settlement was
  computed against. Adding new spending afterwards is fine and deliberately unguarded.
- A settlement is not capped at what is owed. Partial and over payments between friends are normal,
  and refusing them would be the bug.
- `@owewell/core` is the wire contract and uses `string` timestamps; the API's own types use `Date`.
  They look duplicated and are not interchangeable. Do not merge them.
- Rate limiting is Cloudflare's own binding, so it is atomic without a counter of ours. It degrades
  open when the binding is missing, which is the case under `wrangler dev` and in tests.

## Testing

Every API test starts from the production schema: `test/apply-migrations.ts` applies the same
migrations wrangler does. Stub outbound calls with `vi.stubGlobal('fetch', …)` — the Worker runs in
the test's own isolate, so that is what it calls.

The browser journey needs a stand-in auth service (`packages/web/e2e/fake-auth.mjs`). The session is
checked by the Worker, not the page, so there is no seam for Playwright to intercept; pointing
`AUTH_URL` at a local server is the only one. Give each spec its own caller if you add requests that
count against a limit.

## Traps this repo has actually hit

- `pnpm deploy` is pnpm's own command, not this repo's script. `DEPLOY.md` said so long before
  anything enforced it, which is the whole difference between writing something down and checking it.
- A 7403 from the D1 API on deploy is almost never permissions. Compare the credentials file's mtime
  against the log filename, remembering the log is UTC: an OAuth token that expired mid-command and
  refreshed a second later looks exactly like an authorization failure.
- `AddExpenseForm` and `AddItemizedExpenseForm` were measured sharing a third of the smaller file
  verbatim. The duplicated comments between them are the symptom, not the problem.
