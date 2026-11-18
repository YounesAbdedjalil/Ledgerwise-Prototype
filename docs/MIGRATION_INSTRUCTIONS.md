# Database migration instructions

These migrations are **not executed by the application**. Apply them manually in
the Supabase SQL Editor, in order. Do not run them against production until you
have reviewed them. The SaaS tenant migration is a separate, data-affecting
rollout; follow [SAAS_READINESS.md](./SAAS_READINESS.md) and test on a restored
staging copy first.

They are additive migrations for the existing prototype schema. The base tables
(`companies`, `company_sources`, `email_drafts`, `conversations`, `messages`,
`calendar_slots`, `bookings`, `suppressed_contacts`, `audit_logs`, and the rest)
must already exist. Do not run them against an empty database.

Migrations 01-06 describe the prototype's shared authenticated workspace. They
do not provide per-user or tenant isolation by themselves. Migrations 07-08
replace that authorization model with organization-scoped access. See
`docs/SECURITY.md` and `docs/SAAS_READINESS.md`.

## SaaS migration order

The expanded migration sequence is:

1. The existing baseline schema must already be present.
2. `20261114_01_source_verification_and_security.sql`
3. `20261114_02_calendar_source_and_booking.sql`
4. `20261114_03_google_calendar.sql`
5. `20261114_04_transactional_calendar_operations.sql`
6. `20261114_05_calendar_security_corrections.sql`
7. `20261115_06_discovery_candidates.sql`
8. `20261118_07_multitenant_foundation.sql`
9. `20261118_08_tenant_safe_calendar_operations.sql`

Steps 8 and 9 assign the current data to a single legacy workspace and change
the authorization model. Do not apply them until the owner assignment and
duplicate checks in `docs/SAAS_READINESS.md` are reviewed. Migration 07 gives the
oldest existing account the owner role by default; update that migration’s
owner-selection rule before applying if a different account should own it.

## 1. Before applying anything

In the Supabase SQL Editor, run and save the output of these queries.

### Existing policies

```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'companies', 'company_sources', 'qualification_scores',
    'email_drafts', 'email_events', 'conversations', 'messages',
    'calendar_slots', 'bookings', 'suppressed_contacts', 'audit_logs'
  )
order by tablename, policyname;
```

### Existing constraints

```sql
select
  conrelid::regclass as table_name,
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in (
    'company_sources', 'calendar_slots', 'bookings', 'conversations'
  )
order by 1, 2;
```

### Existing triggers

```sql
select
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by 1, 2;
```

### Current source verification state

```sql
select
  count(*) filter (where verification_status is null) as null_status,
  count(*) filter (where verification_status = 'pending_review') as pending_review,
  count(*) filter (where verification_status = 'verified') as verified,
  count(*) filter (where verification_status = 'rejected') as rejected,
  count(*) as total
from public.company_sources;
```

Before migration 01, `verification_status` may not exist yet. That is expected.

### Duplicate suppression rows

Migration 01 adds a unique index on `lower(email)`. Check for existing duplicates
first:

```sql
select lower(email) as normalized_email, count(*)
from public.suppressed_contacts
group by lower(email)
having count(*) > 1;
```

If that returns rows, resolve them before applying migration 01. Do not simply
delete rows: after migration 01 the append-only trigger rejects deletes. Export
the rows and have the data owner decide which record is authoritative.

## 2. Apply migration 01

Open:

```
supabase/migrations/20261114_01_source_verification_and_security.sql
```

Paste the entire file into the Supabase SQL Editor and run it once.

What it does:

- Adds `imported_by`, `verification_status`, `reviewed_by`, `reviewed_at`, and
  `verification_note` to `company_sources`.
- Copies the old `verified_by` value into `imported_by`.
- Sets every existing source to `pending_review`, clears the old `verified_by`,
  and leaves all claims, URLs, titles, dates, and evidence untouched.
- Adds `verification_status` validation and indexes.
- Adds `conversations.ai_processing_at`.
- Replaces policies on the listed tables with authenticated-only policies.
- Adds append-only triggers on `suppressed_contacts` and `audit_logs`.
- Adds the `is_suppressed` and `suppress_contact` RPCs.
- Ensures a unique index exists on `lower(email)` for `suppressed_contacts`.

The one-time source backfill only runs when `verification_status` does not yet
exist. Re-running the file does not erase later human review decisions.

## 3. Verify migration 01

```sql
select verification_status, count(*)
from public.company_sources
group by verification_status
order by 1;

select count(*) as sources_with_old_verified_by
from public.company_sources
where verified_by is not null;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'company_sources'
  and column_name in (
    'imported_by', 'verification_status', 'reviewed_by',
    'reviewed_at', 'verification_note', 'verified_by'
  )
order by column_name;

select proname
from pg_proc
where proname in ('is_suppressed', 'suppress_contact');
```

Expected:

- Every existing source is `pending_review`.
- `sources_with_old_verified_by` is 0 after the one-time backfill.
- Both RPCs exist.
- Claims, URLs, titles, retrieval dates, and evidence are unchanged.

## 4. Apply migrations 02 and 03

After migration 01 is verified, run these files in order in the SQL Editor:

```
supabase/migrations/20261114_02_calendar_source_and_booking.sql
supabase/migrations/20261114_03_google_calendar.sql
```

Migration 02:

- adds `conversations.booking_request`;
- replaces the calendar source check with `calcom | demo | internal`;
- changes the default source to `internal`;
- creates the partial unique index
  `bookings(slot_id) WHERE slot_id IS NOT NULL AND status IN ('pending','confirmed','needs_human')`;
- adds booking indexes.

Before running migration 02, check for existing slot conflicts:

```sql
select slot_id, count(*)
from public.bookings
where slot_id is not null
  and status in ('pending', 'confirmed', 'needs_human')
group by slot_id
having count(*) > 1;
```

If that returns rows, resolve the duplicates before creating the unique index.

Migration 03 adds optional Google Calendar metadata:

- `bookings.google_event_id`;
- `bookings.calendar_sync_status` (`not_configured | pending | synced | failed | deleted`);
- `bookings.calendar_synced_at`;
- `calendar_slots.google_calendar_id`.

Google Calendar is optional. Read `docs/GOOGLE_CALENDAR.md` before enabling sync.
Migration 03 drops and re-adds its status check constraint, so it is safe to
re-run after an earlier draft that did not include `deleted`.

Verify the occupancy rules:

```sql
select slot_id, status, count(*)
from public.bookings
where slot_id is not null
group by slot_id, status
order by slot_id;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'bookings';
```

Expected: no slot has more than one booking in `pending`, `confirmed`, or
`needs_human`.

## 5. Rollback notes

There is no automatic rollback runner. If you need to undo migration 01:

- restore the saved policies from step 1;
- drop the functions `public.is_suppressed(text)` and
  `public.suppress_contact(text, text, uuid)`;
- drop the triggers `suppressed_contacts_append_only` and
  `audit_logs_append_only`;
- drop the added indexes;
- drop the added columns only if you are certain you do not need the verification
  history. Dropping the columns loses review decisions.

Do not drop or recreate `company_sources`; it contains the research data.

## 6. Important consequence

After migration 01, no source is eligible for email personalization until a human
opens `/prospects/review` and marks it verified. This is intentional. Importing a
structurally valid row is not the same as verifying that the claim is true.
