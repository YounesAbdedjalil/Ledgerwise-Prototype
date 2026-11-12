# Ledgerwise Prototype: Scope Note

## Goal
An AI sales assistant for Ledgerwise's sales team: find and qualify US e-commerce
prospects, draft first emails, handle replies under strict rules, and book calls.
The sales team stays in control at every step.

## Stack
Next.js (App Router, TypeScript), Supabase (auth + Postgres), Vercel, Cal.com.

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
4. Calendar / Bookings (Cal.com)

## Current status
- Built: login, protected dashboard shell, four empty pages, deployment
- Not built yet: database schema, research data, scoring, email drafts,
  reply handling, guardrails, Cal.com integration

## Email sending
Approval queue only. Any send is labeled "Simulated send: demo path"
unless verified provider credentials are supplied and explicitly approved.

## Research integrity
Every company fact needs a source URL, title, retrieval date and evidence.
Unverifiable facts are marked "unknown".
