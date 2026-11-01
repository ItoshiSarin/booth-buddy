# Booth Buddy — pre-launch integration acceptance checklist

Run against your own staging Supabase project. Use imaginary brands and non-sensitive test documents. Capture screenshots and the expected/actual outcome for each test.

## Must pass before real merchants/payments

- [ ] Supabase `schema.sql` executes cleanly in a new project (no SQL errors).
- [ ] Vercel Vite build succeeds; all environment variables are set; no secret/service-role key is shipped to browsers.
- [ ] Register A on Device 1, confirm email with a real code, sign in with correct password; wrong password is rejected.
- [ ] Register B on Device 2; both accounts have separate private profiles, documents and bookings.
- [ ] One merchant cannot read another's ID document or payment proof; admin can inspect them.
- [ ] Admin role is assigned only through trusted SQL procedure. Non-admin cannot edit events, change booking statuses or read other profiles.
- [ ] A merchant's uploaded ID is marked PENDING until an authorized organizer verifies it.
- [ ] Exactly 13 category options appear; each same-category pairing is blocked.
- [ ] Identical normalized product tags are blocked regardless of capitalization/spacing.
- [ ] Different category with non-approved pairing is labeled REVIEW (not automatically certified compatible).
- [ ] Cross-category synonyms/overlaps not caught by exact tags are identified during the required human review.
- [ ] An event's real stalls are consistent across accounts; two events never share occupant records.
- [ ] Shared Stall A-01 may hold two merchants maximum; Solo A-02 may hold one only.
- [ ] Concurrent requests from 3 devices for the same last half result in only one successful reservation.
- [ ] A second merchant cannot join a first merchant whose booking is not yet approved.
- [ ] A merchant cannot book twice in the same event (unless the previous booking was cancelled/declined/expired).
- [ ] A first Shared occupant can be approved while waiting for a buddy, but **no matched gate pass or private buddy details unlock yet**.
- [ ] Both verified and payment-approved Shared occupants unlock each other's info and their own gate passes.
- [ ] Solo booking never displays a fabricated buddy.
- [ ] Reservation holds expire after 30 minutes and reopen inventory. Expired proof submission is rejected.
- [ ] Supabase recalculates server-side booth price and optional supplies even if browser form totals are changed.
- [ ] Equipment stock cannot be oversold for overlapping event dates; supplies are available for non-overlapping dates.
- [ ] One-per-stall rental equipment cannot be booked twice by two merchants in the same Shared stall.
- [ ] Declining/cancelling a reservation frees the stall and equipment; the previous price is preserved in booking history.
- [ ] Incorrect merchant profile/category edits during active bookings are rejected.
- [ ] Payment method details and QR image are real, verified and the displayed payee is correct.
- [ ] Screenshot alone never auto-approves a payment; a human independently verifies the transaction.
- [ ] Refunds are not marked completed until an actual refund transaction reference is recorded.
- [ ] Only approved, fully matched Shared bookings may check in; a repeated pass or invalid UUID fails.
- [ ] Admin audit history records status/verification decisions with actor and timestamps.
- [ ] Test anonymous, signed-in merchant, and organizer views in a mobile browser and desktop browser.

## Business acceptance decisions still required

- [ ] Written unmatched-buddy policy and decision deadline approved by team.
- [ ] Written cancellation and refund policy published.
- [ ] Merchant brand/product conflict escalation policy approved by team.
- [ ] Event floorplan verified against actual rentable area, utilities, fire exits, venue rules and safety permits.
- [ ] Privacy notice, data retention/deletion workflow and merchant support contact configured.
- [ ] Disaster recovery, payment dispute response and organizer backup staffing documented.
