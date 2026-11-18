# Security model

## Tenant boundary

Ledgerwise uses a shared Supabase database with organization-scoped rows. Every customer-owned table has a non-null `organization_id`: companies, sources, scores, drafts, email events, conversations, messages, calendar slots, bookings, suppression records, audit logs, and discovery candidates.

A signed-in user's active organization is stored in `public.users.active_organization_id`. The database resolves it only when the user has a membership. The organization switch RPC verifies membership before changing it. RLS limits reads and writes to that active organization, and database triggers reject tenant changes and cross-organization foreign references, including writes through SECURITY DEFINER calendar and suppression RPCs.

Never add a customer-owned table without an organization key, RLS policies, explicit grants, and cross-tenant relationship checks. Do not use a service-role client for tenant data unless every operation explicitly scopes organization IDs.

## Roles

Organization roles are `owner`, `admin`, `member`, and `viewer`.

- Owners and admins can manage team membership; only owners can grant admin access.
- Members can use the prospect, email, conversation, and calendar workflows.
- Viewers are read-only. Server actions and the discovery endpoint check write permission before doing provider work, and database policies enforce it again.
- Audit records and email events are append-only. Suppression records can only be added through the authenticated RPC and are append-only.

The migration assigns existing rows and users to one legacy organization. The oldest existing public user becomes its owner. Review that account assignment before rollout.

## Authentication and invitations

Supabase Auth handles passwords and email confirmation. The app includes an auth callback route and organization onboarding. Team invitations use the server-only `SUPABASE_SERVICE_ROLE_KEY`; never expose or log it. Configure Auth email delivery and redirect allow-list entries for `/auth/callback` and `/onboarding`.

Configure signup confirmation, CAPTCHA / abuse protection, password policy, session settings, and SMTP in Supabase Auth before enabling public registrations. Sign-up alone does not create a workspace until the user creates one or accepts an invitation.

## Secrets and providers

Keep all credentials in encrypted host environment settings and local `.env.local`. The service-role key must remain server-only. Current AI, Tavily, Brevo, and Google Calendar credentials are application-wide environment values, not customer-specific integration credentials. Do not claim customer-managed integrations or independent provider billing until those are implemented.

## Limits

The application has no subscription billing, per-organization usage metering, distributed rate limiting, data export/deletion workflow, or organization deletion/ownership-transfer UI yet. These remain launch requirements for a commercial SaaS. Inbound email sync is also not connected, and email sending remains simulated unless the shared Brevo live-send switch is enabled.

Apply database changes only through reviewed migrations. Verify policies and tenant isolation with at least two test organizations before production.
