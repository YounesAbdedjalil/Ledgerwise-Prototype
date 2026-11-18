# SaaS rollout and readiness

## Current implementation

The application now has organization onboarding, an organization switcher, membership invitations, member role management, and tenant-aware database policy/migration changes. The data model uses a shared database and schema, with row-level security enforcing the active organization. Existing data is migrated together into a legacy workspace.

## Required database rollout

Do not apply this migration to production until the backup and preflight checks below are complete. The migration is transactional, but adding uniqueness constraints can fail if existing duplicate rows are found.

1. Take and verify a Supabase backup. Use a staging project first.
2. Confirm the intended owner for the legacy workspace. By default, the migration assigns the oldest account in `public.users` as owner; all other existing users become members.
3. Check duplicate companies and sources before applying the tenant migration:

```sql
select website, count(*) from public.companies group by website having count(*) > 1;
select company_id, source_url, md5(source_url || chr(31) || claim), count(*)
from public.company_sources
group by company_id, source_url, md5(source_url || chr(31) || claim)
having count(*) > 1;
```

Resolve duplicates by merging or choosing records before rollout. Do not delete audit or suppression records.

4. Confirm migrations 04 and 05 were applied to the target database. The repository now tracks them in `supabase/migrations`; earlier copies were kept under `supabase/unapplied`. If they were already applied manually, compare their function definitions with the tracked versions.
5. Apply migrations in order through `20261118_07_multitenant_foundation.sql` and `20261118_08_tenant_safe_calendar_operations.sql`. The 08 migration reapplies tenant-scoped calendar routines for projects that previously applied the prototype RPCs.
6. Confirm every tenant table has non-null `organization_id`, RLS is enabled, anonymous grants are absent, and the signed-in user can see only its active organization.
7. Test two organizations in staging. Create records in each, switch organizations, and attempt direct API reads/writes and RPC calls using IDs from the other organization. Confirm all cross-organization access is denied, including calendar operations and contact suppression.

## Application environment and Supabase Auth

Set these host environment values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` (deployed origin, used for invitations)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, required to send Auth invitations)

Keep the service-role key out of browser variables and client bundles. The team invitation action uses it only on the server.

In Supabase Auth, configure production Site URL and redirect allow-list entries for `/auth/callback` and `/onboarding`; configure SMTP, email confirmation, CAPTCHA / abuse protection, password policy, and session lifetime. Public registration is now available in the login screen, so do not enable it until email delivery and abuse protections are configured.

## Before inviting paying customers

These are still product or operational work, not completed by the tenant-isolation changes:

- Subscription billing and plan-based quotas. Temporary database caps currently allow two discovery runs and 40 AI generations per organization per UTC day; they are not connected to a paid plan.
- Per-user request rate limits and detailed usage/cost metering. The temporary counters cap provider calls by organization but do not track tokens or provider spend.
- Organization deletion, ownership transfer, data export, and retention controls.
- Customer-specific provider credentials and integration setup; current AI, Tavily, Brevo, and Google credentials are global.
- Inbound email synchronization; the current conversation flow uses manual/simulated messages.
- Production monitoring, alerting, incident response, and tested restore procedures.
- Privacy policy, terms, data processing terms, and provider disclosures reviewed for the intended markets.
- End-to-end checks for real email and Google Calendar with production-like accounts. Email sending remains simulated by default; Google Calendar is shared application configuration.

The app should not be marketed as commercially launch-ready until these items are resolved and the two-organization isolation checks pass.

### If migration 07 fails during the organization backfill

Migration 07 updates only the new `organization_id` metadata on existing rows,
including append-only audit and suppression tables. It temporarily disables
those tables' append-only triggers for that backfill and restores them before
commit. The migration is wrapped in a transaction, so an error should roll back
the whole migration. Verify that it rolled back before retrying; do not continue
to migration 08 after a failed 07.
