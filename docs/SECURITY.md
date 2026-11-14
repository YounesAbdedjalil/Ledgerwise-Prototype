# Security model

## Scope

This is a single-team internal prototype. It is not a multi-tenant product. The
Supabase policies use the `authenticated` role and `using (true)` checks. Any
signed-in user can read and, where allowed, write the same rows.

Do not present this as per-user or per-tenant isolation. If the prototype is ever
opened to more than one team, add an organization/team column, store the caller's
team, and scope every policy and query to it.

## Authentication

- Supabase email/password login is required by the proxy for every route except
  `/login`.
- New signups are expected to be disabled in Supabase.
- The app never uses the `service_role` key in browser code.

## Row-level security

Migration 01 enables RLS and replaces policies on:

`companies`, `company_sources`, `qualification_scores`, `email_drafts`,
`email_events`, `conversations`, `messages`, `calendar_slots`, `bookings`,
`suppressed_contacts`, `audit_logs`.

The rules are deliberately narrow where the product requires it:

- `email_events`, `audit_logs`, and `suppressed_contacts` allow select and insert
  only. There is no update or delete policy.
- `bookings` allows select, insert, and update. There is no delete policy;
  cancellation is the supported path.
- `calendar_slots` allows delete, but the application refuses to delete a slot
  with an active booking.

Database triggers also reject update/delete on `suppressed_contacts` and
`audit_logs`, so a future policy mistake does not silently rewrite an opt-out or
audit record.

## Source verification

Every imported source starts as `pending_review`. A source is eligible to support
email personalization only when all of the following are true:

- `verification_status = 'verified'`;
- `reviewed_by` and `reviewed_at` are set by a signed-in user;
- the claim type is one of the email-usable types;
- the URL is a real HTTP(S) URL and the evidence is non-empty.

In addition, the recipient address must appear in a **verified `contact` source**
for that company. Creating, revising, or sending a draft is blocked until that
contact source is verified. A human editing `companies.contact_email` is not
enough on its own.

Rejection requires a note. Resetting a review requires a reason. Both actions are
written to `audit_logs`.

## Contact suppression

`suppressed_contacts` is append-only. The `suppress_contact` RPC normalizes the
email, inserts once, and records an audit row. `is_suppressed` is checked before
creating or revising an email draft, before a simulated send, before approving an
AI reply, and before creating, confirming, or rescheduling a booking. Inbound
opt-out messages suppress the contact before any reply is generated. Cancelling a
booking remains allowed so an existing hold can always be released.

## Sending and calendar claims

- No real email is sent. Approved drafts become `sent_simulated`, and every
  message row is written with `is_simulated = true`.
- The internal calendar is the source of truth for bookings. Google Calendar is
  optional. The UI reports it as not operational until credentials are present,
  the operator explicitly marks it verified, and sync is enabled. When enabled,
  booking creation, rescheduling, and cancellation create, update, or delete the
  linked Google event; failures never roll back the internal booking.

## Secrets

Keep Supabase, AI, and Google credentials in `.env.local` and in the hosting
provider's environment settings. Never commit `.env.local`. The research and
test code does not print keys.