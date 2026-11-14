# Ledgerwise Prototype: Scope Note

## Goal
An AI sales assistant for Ledgerwise's sales team: find and qualify US e-commerce
prospects, draft first emails, handle replies under strict rules, and book calls.
The sales team stays in control at every step.

## Stack
Next.js (App Router, TypeScript), Supabase (auth + Postgres), Vercel. The
prototype uses an internal calendar as the source of truth and an optional Google
Calendar sync. Cal.com remains a future integration option.

## Hard rules (enforced in application code, not only in prompts)
- Never quote prices or make pricing promises
- Never invent company facts; unverified facts are stored as "unknown"
- Never contact anyone after an opt-out; suppression is permanent
- Always disclose being an AI when asked
- Escalate anything uncertain, sensitive, legal, or unusual to a human

## Screens
1. Prospects (list + company detail with sources)
2. Email review (approve / edit / reject, audit trail)
3. Conversations (threads, takeover, opt-out suppression)
4. Calendar / Bookings (internal calendar; optional Google Calendar sync)

## Current status
- Built: login, protected dashboard shell, research/import pipeline, source
  review, scoring, email drafts and review, reply handling with guardrails,
  internal calendar and bookings, and optional Google Calendar create/update/
  delete sync.
- Email sending is simulated. No real provider is connected.
- Google Calendar is optional and is not claimed operational until real OAuth,
  event create/update/delete sync, and an external check have been verified.
- Cal.com is not integrated. The internal calendar provides real stored slots,
  occupancy rules, and bookings for the prototype.

## Email sending
Approval queue only. Any send is labeled "Simulated send: demo path"
unless verified provider credentials are supplied and explicitly approved.

## Research integrity
Every company fact needs a source URL, title, retrieval date and evidence.
Unverifiable facts are marked "unknown".
