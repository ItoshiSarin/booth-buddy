# BOOTH BUDDY — Vercel + Supabase implementation baseline

**Important:** This is a complete **deployable project structure**, not a single HTML file. It replaces the unsafe localStorage prototype with Vite, Supabase Auth, private Storage, PostgreSQL Row-Level Security and atomic booking functions. The final integration testing, actual venue/merchant/payment setup, privacy and consumer-policy review, and independent financial reconciliation must still be completed by your group before public commercial use. Do not claim this code has already been production-certified.

## Architecture

- **Vercel:** Website hosting / continuous deployment / public URL.
- **Supabase:** Email/password authentication, email verification, PostgreSQL for merchants/events/stalls/bookings/equipment, private KYC documents and payment proof, and database-backed authorization.
- **Matching:** Real approved first occupants only, unique physical stalls, same-category and identical normalized product-tag blocking, an approved complementary-category matrix, case-by-case admin review, transactional capacity enforcement, two-merchant confirmation, delayed partner reveal.
- **Payment:** Real payment is handled outside this site through the organizer's verified GCash/Maya/bank details; users submit proof; admin must reconcile independently. **Not an integrated payment processor.**
- **Privacy:** No sample merchant accounts/passwords, no exposed admin credentials, no public KYC documents; photo marketing consent is optional.

## Files

```
index.html                  # Vite HTML entry
src/main.js                 # Merchant/admin UI and Supabase client
src/style.css               # Responsive Booth Buddy design
src/matching.js             # Conservative client-side eligibility descriptions
supabase/schema.sql         # Tables, RLS, private storage, transactional RPCs
supabase/setup_admin.sql    # One-time manual admin assignment (edit the UUID!)
.env.example                # Public browser-safe project configuration names
vercel.json                 # SPA navigation fallback
package.json                # Dependencies and commands
tests/matching.test.mjs     # Deterministic category-product matching tests
QA_CHECKLIST.md             # Manual cross-device testing protocol
```

## First-time setup (recommended order)

### 1 — Create your Supabase backend

1. Sign in at https://supabase.com and create a **new** project. Keep its database password private.
2. Go to **SQL Editor** and run the entire `supabase/schema.sql` in a new project. This creates the tables, matching RPCs, private buckets and RLS policies. Do not repeatedly rerun this non-idempotent schema in an existing project. For future revisions, use SQL migrations.
3. Go to **Authentication → Providers → Email** and keep email confirmation enabled. In **Authentication → Email Templates → Confirm signup**, put `{{ .Token }}` in the email instead of or alongside a confirmation link. The frontend accepts numeric 6–8 digit tokens; exact length depends on Supabase settings/version. Use the real code received by email. Configure a suitable email sender/SMTP for non-demo usage.
4. In **Authentication → URL Configuration**, set the Site URL to your deployed Vercel domain and add the Vercel domain and testing/preview domains you actually use to redirect allowlists (avoid broad wildcard allowances in production).
5. Under **Project Settings → API / Connect**, copy the **Project URL** and the **publishable key**, or legacy `anon` key. NEVER place the service-role/secret key or database password in frontend files.

### 2 — Deploy to Vercel using Git

1. Create a GitHub (or other supported Git provider) repository for the **contents of this project folder**, not the ZIP as one opaque file. Include the `src` and `supabase` folders, `package.json`, and `vercel.json`.
2. Import the repository at https://vercel.com/new (or update your existing Vercel Git-connected Booth Buddy project).
3. Framework preset: **Vite**. Build command: **`npm run build`**. Output directory: **`dist`**. Root directory: the folder containing `package.json` (usually `./`).
4. Vercel **Project Settings → Environment Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are intended as public client configuration only; never use a service role key.
5. Deploy (or redeploy after adding variables). Check your generated `*.vercel.app` URL. Recheck Supabase redirect allowlists.
6. You may deploy locally with `npm install`, `npm run dev`, `npm run test`, `npm run build`. Local development requires creating `.env.local` from `.env.example`.

> **If your current Vercel project deploys by uploading/pasting a single `index.html`: that workflow must change.** This is a multi-file Vite project with a build step. A Git-connected Vercel project is the easiest way for groupmates to update it together. You can keep your existing Vercel domain/project but reconfigure it for this repo and framework. Keep a backup of the old site.

### 3 — Create your own admin account

1. Register an email account on the newly deployed website, complete its email confirmation, and sign in.
2. Supabase Dashboard → **Authentication → Users**: find the account and copy the **UUID** (not the email address).
3. Edit `supabase/setup_admin.sql` to replace the all-zero placeholder UUID with your UUID, then run that single statement in the Supabase SQL Editor. The placeholder is deliberately invalid to avoid accidentally promoting strangers.
4. Refresh the website. Your account will now have an **Admin** link. Its authorization is enforced by the database. There is no default admin password.

### 4 — Configure real events, stalls and payment accounts

1. Admin → **Events & Floorplan**: create an event with the real venue, time (interpreted as Manila time), per-merchant Solo/Shared rates and venue facilities. It starts **UNPUBLISHED**.
2. Add every physical stall with a unique code, mode (Solo/Shared) and electricity option. Publish only after entering real inventory.
3. Admin → **Payment Accounts**: add your verified account/payee/instructions. An option starts **DISABLED**. Enable only after verifying its information; a QR image must be provider-issued and actually scannable, not a textual QR generated by the app.
4. Admin → **Equipment**: configure actual rental items, quantities and prices. Do not advertise stock you have not sourced.
5. Add the actual event cancellation/refund terms, unmatched-buddy resolution options and a privacy notice before accepting public payments. The code does **not** invent these business-policy decisions.

### 5 — Verify the actual two-merchant journey

1. Use two independent email accounts in two separate browsers/devices.
2. Register Merchant A (beverage with coffee-only tags), verify email, upload an appropriate test document. Admin separately approves the merchant. Do not use real IDs in a public demo database.
3. Merchant A reserves an empty Shared stall. The server creates a 30-minute pending-payment hold. Upload test payment proof; admin records verification **only** if corresponding test transactions are genuinely reconciled (or an isolated sandbox process clearly marked as simulation).
4. Admin approves Merchant A's booking. Merchant A is **approved, waiting for a buddy**. Their gate pass remains unavailable.
5. Merchant B (food/pastries) registers independently and has the appropriate documents/products verified. Merchant B should see Merchant A as a real existing candidate for that exact event and stall.
6. Merchant B reserves the second half. Confirm that no third user can reserve it, even with near-simultaneous requests. Admin reviews B and their payment, then approves.
7. **Only now** should both users see each other's full partner details and their own gate passes.
8. Admin can validate the pass using the check-in screen close to the event date; repeated check-in is refused. See `QA_CHECKLIST.md`.

## Business rules and deliberate limitations

- Same primary category = blocked. Identical *normalized* product tags = blocked. Cross-category product synonyms are **not** automatically recognized ("latte" vs "iced latte"), so admins must inspect actual product lists. No unsubstantiated AI percentage scores are presented.
- Conservative auto category pair list: Beverage+Food; Fashion+Footwear/Jewelry/Beauty; Footwear+Jewelry; Beauty+Jewelry/Fragrance; General+Crafts. Other **different** categories may request explicit admin review. Their eligibility is not guaranteed.
- A first Shared occupant must be **approved** before new users can join their stall. Only real approved profiles are surfaced, not seeded demo partners.
- Database RPCs serialize reservations with a lock on the physical stall and enforce one Solo booking or two Shared occupants. Only one active booking per merchant per event is allowed.
- All amounts are computed on the server. Rental inventory is checked for overlapping event dates. An expired pending-payment hold stops occupying the stall; the old record may still display as expired locally until a new lifecycle update is implemented.
- An unmatched, declined or cancelled Shared booking may require organizer intervention: refund, Solo upgrade, transfer, manual rematch or other option **only under the event's posted terms**. Do not promise automatic handling—the current product does not automatically rematch merchants or issue refunds.
- A payment receipt is *reported evidence*, not proof of settled funds. Admin actions require a manual attestation and log a transaction-reference for refunded cases; no e-wallet/bank API is integrated.
- The UI does not provide fully automated email notifications, a full consumer support ticketing platform, self-service approved-booking cancellation, or account password recovery screens. Supabase's managed password-reset mechanisms can be added in a later iteration.
- Booking IDs are cryptographically random UUIDs. Gate passes are not public permits; they are validated by a signed-in organizer against real approved bookings. No tax/POS or QR penalty-scanner module has been added.
- This project is a **deployable foundation requiring real Supabase integration and acceptance testing**, not a guarantee of flawless or certified production readiness.

## Important security guidance

- Never commit `.env.local`, passwords, service-role keys, or customer identification documents to a repository.
- Never use the old HTML demo's embedded personal financial details or sample admin credentials as real values.
- Do not give public users access to the admin panel or broad SQL Editor privileges.
- Review the Philippine Data Privacy Act and data-retention/ID-document requirements with a qualified adviser. Publish a privacy notice and retention policy; restrict document collection to what is necessary.
- Enable database backups/monitoring, rate limits, spam and abuse protection, QA logging and recovery procedures before a commercial launch.

## Sources

- Vercel's Vite deployment and build docs: https://vercel.com/docs/frameworks/frontend/vite
- Supabase database functions and security rules: https://supabase.com/docs/guides/database/functions
- Supabase RLS guidance: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase email templates: https://supabase.com/docs/guides/auth/auth-email-templates
- Supabase private storage: https://supabase.com/docs/guides/storage/serving/downloads
