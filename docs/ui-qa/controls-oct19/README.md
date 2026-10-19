# Group and payment controls — October 19

Cancel closes an empty group draft without briefly marking its name invalid. Pointer and keyboard cancellation return focus to New. Ordinary field validation remains available.

Both payment-method controls keep native menus with an inset chevron. Pointer selection keeps a quiet border; keyboard navigation retains a visible outline. Payment values, recipient preferences and ledger calculations retain their behavior.

| Reviewed state                    | Desktop                                | Phone layout                         |
| --------------------------------- | -------------------------------------- | ------------------------------------ |
| Cancel held down, before release  | [1440px](cancel-1440.png)              | [390px](cancel-390.png)              |
| Settlement method, keyboard focus | [1440px](settlement-keyboard-1440.png) | [390px](settlement-keyboard-390.png) |
| Payment sheet, pointer selection  | [1440px](payment-pointer-1440.png)     | [390px](payment-pointer-390.png)     |

The settlement outline shown above is intentional keyboard feedback. Pointer interaction is checked separately in the browser regression. Captures use a 900px viewport height; warm and dark layouts were visually reviewed.

The Cancel regression failed while the pointer was held down before the fix. The dropdown regression rejected the original arrow spacing. Repository, build and unit gates passed. The complete Chromium and WebKit browser suite passed after isolating each scenario's fake account. The fresh-account assertion also rejected the old shared identity, whose directory had accumulated earlier runs. No existing assertion, timeout or retry setting was relaxed.

The initial combined verification run retained browser timeouts from those shared test accounts; browser verification was rerun after the fixture correction. Final changed-file lint, formatting and documentation checks were checked separately.

These are responsive browser layouts, not physical iPhone checks. Native phone keyboards, gestures, OS menus and spoken screen-reader output remain unverified. All accounts and ledger records used here are local test data.
