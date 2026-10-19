# Owewell UI

Owewell has its own deep teal, warm ivory and receipt-paper identity. Warm and dark preferences remain
available, including the saved choice and automatic device preference. Inter remains locally
served. Teal identifies actions; green and red retain their money meanings and explicit labels.

The signed-out calculator opens with a spacious teal headline and a small smiling receipt illustration. The working calculator sits directly below in one centered, softly framed panel; visitors can jump to it or explicitly load a labeled example. There is no sidebar or numbered tutorial. Phones prioritize the headline and tool without the illustration. The signed-in overview has a page title, a quieter balance card
and a two-column group directory on wide screens; phones retain a single column. Group detail
keeps its focused column, with a paper balance card and consistent form boundaries.

Humor belongs in the introduction, not amounts, validation, payments or destructive decisions.
The split math, rounding, saved drafts, offline queue, group membership and shared Accounts
redirects retain their existing behavior. Movement respects the existing reduced-motion setting.
Icons, installed-app metadata and sharing graphics use the shipped warm palette.

Visual evidence and verification notes live in `docs/ui-qa/README.md`.

Balance figures take priority over metadata; the overview separates owed-to-you and you-owe
into labeled tiles when both are present. Ledger amounts align on the right, with quieter
payer/date text and consistently sized category glyphs. Sheets use a grip on phones, distinct
selected modes, and a sticky action bar. Existing keyboard focus and scroll locking remain.

The receipt face appears in inviting empty states and successful status messages. Its nod and
blink run once on confirmation and are disabled for reduced motion. Errors retain their alert
icon and clear copy. Paper illustrations are decorative and do not contain ledger values.

The group ledger has an in-flow Add expense action above its filters. Payment logging is a labeled secondary button; settlement recording retains its primary action, and expense rows separate stronger titles and amounts from quieter payer metadata.

The calculator leads each bill row with its amount. Descriptions and split methods live behind
a native keyboard-accessible disclosure; existing described, itemized or unequal drafts expose
their details automatically. Results emphasize the visitor’s own share before payment transfers.

Payer selection is one labeled Who paid? control. Tips are an optional disclosure. Inline amount
errors explain valid positive amounts before saving. Copy summary is the primary result action;
saving stays secondary. Blank calculators explain what is needed to produce an answer.

Signed-in groups pair the latest real expense with Add expense directly below the balance,
before settlement detail. Expense entry keeps amount, description, payer and split visible;
optional date, category and note live in a disclosure, expanded when editing or copying.
Successful new expenses remember only the group’s split method and participants on this device.
Amounts and exact/percentage allocations always start fresh; shares restart at one each.
Preferences are checked against the current roster and never override an edit or template.

Settlement actions say Record payment and explain that the app only updates the ledger.
The confirmation identifies sender, recipient, amount and payment method. Manual payment entry
keeps sender and recipient labels visible and summarizes the record before submission. The
recorded receipt gives its amount stronger hierarchy and announces the successful recording.

Group directory balances include explicit Owed to you / You owe labels. The overall balance
explains when opposing group balances net to zero without settling either group. Activity dates
are labeled as updates; new accounts have one first-group action and a labeled group-name field.

Group options support arrow keys, Home/End and Escape with focus returned to the trigger.
Rename and member edits show saving states and block repeated submissions. Detail-page group
and member names wrap rather than hiding their full text; notes and large amounts wrap safely.
Options use the theme’s surface for keyboard focus, and disabled controls retain a visible cue.

Unfinished expense and payment sheets ask before discarding changes, including browser back
and page exits. Expired sign-in errors offer a separate sign-in tab so entered fields remain
in the original form for retry. Offline payment records remain excluded from balances until
synced; invite conflicts refresh the roster and invalid links explain how to request a new one.

Expense and payment text inputs advance on Enter without submitting. Money fields request the
mobile Next key; narrow screens constrain large amounts and give participant choices a full
tap target. Installed apps refresh HTML, icons and metadata online while retaining cached
hashed bundles offline. Update checks never reload an unfinished form automatically.

Dialog keyboard traps include disclosure summaries and exclude hidden controls. Nested dialogs
handle their own keys. Closing Members returns to Group options; the first expense returns to
the replacement Add expense action when the empty state disappears. Saving and payment
recording expose polite status announcements and busy button states.

Payment receipts explicitly distinguish a saved ledger record from a money transfer. Shared invites explain that viewing is read-only and choosing an existing name connects that spot and its balances to an account. Long unbroken names wrap in payment and shared-member rows; large shared totals scale to fit without shortening the amount.

The visual directory uses distinct title, balance and activity rows inside each group card.
Balances have calmer medium-weight numerals; a larger receipt face and fine accent rule tie
overview and group heroes together. The latest-expense action uses a dashed paper boundary
instead of competing with the balance card. Activity has a visible heading and tighter spacing.
Hover-capable devices get a small card lift and chevron movement unless reduced motion is set.

Expense, itemized receipt and payment sheets share a dashed total panel with an explicit label
and medium-weight numerals. Participant rows sit inside a quiet ruled boundary; sender and
recipient controls share one panel. Selected entry modes use a soft teal surface and subtle
shadow. The total panel owns its visible focus outline so the numeric field has one clear cue.

Itemized receipt rows use numbered paper panels, aligned name and amount fields, quiet selected
participant tags and a dashed payer divider. Category choices use compact rounded rectangles
and reserve teal for the selection. Form order, native controls and calculation behavior remain.

Calculator bill rows use soft paper panels, medium-weight amounts and dashed disclosure rules.
The running total shares the labeled receipt treatment with entry sheets; your share has the
strongest result hierarchy, with quieter transfer rows. Results fade in once when they appear,
only when reduced motion is not requested. The existing layout and calculation flow remain.

Payment-method selects keep native menus with an inset chevron and the shared field spacing.
Pointer use keeps a quiet border; keyboard navigation retains a visible focus outline.
Cancelling group creation closes the draft without validating its empty name and returns focus to New.
