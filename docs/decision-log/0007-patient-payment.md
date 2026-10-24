# 0007 — The patient pays with Stripe Checkout before the call

Status: accepted 14 October 2026, by the owner ("until we get to the stripe payment
incorporated into the system"; option A of the three offered on 14 October). Test mode until Gate R.
Amended 24 October 2026 by the owner: rows 8 and 9.

| # | Decision | Consequence |
|---|---|---|
| 1 | The patient pays on Stripe's hosted Checkout page, opened from their link, before the call. No account. | Watson never sees card details. Built from Stripe's public guides (Checkout quickstart, order fulfilment). |
| 2 | The practitioner sets a fee per consultation, in euro, when creating it. No fee: no payment step. | `consultations.fee_cents`, 0.50 to 1000.00. |
| 3 | The money goes to the owner's own Stripe account. | Paying each practitioner directly (Stripe Connect) is a later decision. Receipts are Stripe's own emails; invoices later. |
| 4 | The patient's link exists from the moment the consultation is created, so it can be sent before the call. | The token is stored with the consultation and readable only by its practitioner. The call room uses the same link (it was made per call in slice 1.4). |
| 5 | A payment counts only when Stripe says so: fulfilled both from Stripe's signed webhook and when the patient returns, through one database function only the server key may call, which checks the amount and is safe to repeat. | Edge functions `payment` and `stripe-webhook`; `record_payment`; audit event `payment.received` with actor `payment`. |
| 6 | Payment gates the patient page, not the call itself: someone holding the link could reach the call's handshake channel without paying. The practitioner sees "Paid" or "Not paid yet". | Before real patients, the handshake must refuse an unpaid link. |
| 7 | Free forever holds for the technology: Stripe charges nothing fixed and test mode is free. | Live payments carry Stripe's per-payment fee, a business cost taken from the payment. |
| 8 | Two prices (owner, 24 Oct): a usual fee on the practitioner's page, and any fee per consultation, starting at the usual fee. 0 is free, with no payment step. | `practitioner_profiles.fee_cents` is the usual fee, paid by patients who book on the page; New consultation starts with it; 0 or empty stores no fee. Non-zero fees stay 0.50 to 1000.00 (Stripe's minimum). |
| 9 | "Make it free" on a consultation not paid yet (owner, 24 Oct). | `make_consultation_free` drops the fee and any wait for the payment, and logs `fee.waived`. Refused once paid, and for a booking whose wait ran out when another patient has booked the time since. A patient paying at that very moment is charged but not recorded (`record_payment` refuses the amount): refund in Stripe. To handle before Gate R. |
