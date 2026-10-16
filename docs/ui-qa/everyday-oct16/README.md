# Everyday money entry

Money fields accept shorthand amounts such as `.50` and `12.`, alongside pasted
amounts such as `$1,200.50`. Blur normalizes valid values to two decimal places.
Malformed input and extra decimal places remain invalid; ledger calculations and
server inputs continue to use integer cents.

The shared parser tests cover accepted and refused values. The real browser
journey enters these values before completing the expense and settlement flow in
Chromium and WebKit. Existing submitting states disable the save controls, and
failures leave the editor available for retry.

These checks do not establish native phone-keyboard or password-manager behavior.
