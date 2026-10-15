# Payment receipt review

The receipt records the exact local time and timezone, shows each changed balance,
and explains that owewell recorded a payment without moving money. Undo is now
available directly on the receipt and keeps the existing confirmation step.

- [Desktop receipt](receipt-desktop.png)
- [Phone receipt](receipt-mobile.png)

Captures use an isolated local group and synthetic people. The group journey records
and undoes the payment, then checks that the balance reopens. Component checks cover
the recorded instant and disabling repeated Undo while waiting for the server.
Physical keyboards and screen-reader speech remain device checks.
