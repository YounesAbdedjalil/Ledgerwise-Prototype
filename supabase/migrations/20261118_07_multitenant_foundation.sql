-- Multi-tenant foundation for Ledgerwise.
-- Review docs/SAAS_READINESS.md and take a backup before production rollout.
begin;
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  created_at timestamptz not null default now()
);
create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);
create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','member','viewer')),
  invited_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (organization_id, email)
);
create table if not exists public.organization_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meter text not null check (meter in ('discovery','ai_generation')),
  usage_date date not null default current_date,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id,meter,usage_date)
);
create index if not exists organization_memberships_user_id_idx on public.organization_memberships(user_id);
create index if not exists organization_invitations_pending_email_idx
  on public.organization_invitations(lower(email),created_at) where accepted_at is null;
alter table public.users add column if not exists active_organization_id uuid references public.organizations(id) on delete set null;
create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public,pg_temp
as $$
 select m.organization_id from public.organization_memberships m
 join public.users u on u.id=m.user_id and u.active_organization_id=m.organization_id
 where m.user_id=auth.uid() limit 1
$$;
-- Preserve prototype data as one shared legacy workspace and keep existing users in it.
insert into public.users(id,email) select u.id,coalesce(u.email,'') from auth.users u on conflict(id) do nothing;
insert into public.organizations(name) select 'Ledgerwise Workspace'
where not exists(select 1 from public.organizations);
insert into public.organization_memberships(organization_id,user_id,role)
select o.id,u.id,'owner' from public.organizations o cross join public.users u
where o.id=(select id from public.organizations order by created_at,id limit 1)
on conflict(organization_id,user_id) do nothing;
with ordered_members as (
 select m.organization_id,m.user_id,row_number() over(partition by m.organization_id order by u.created_at,u.id) as position
 from public.organization_memberships m join public.users u on u.id=m.user_id
)
update public.organization_memberships m
 set role=case when o.position=1 then 'owner' else 'member' end
from ordered_members o where o.organization_id=m.organization_id and o.user_id=m.user_id;
update public.users u set active_organization_id=m.organization_id
from public.organization_memberships m where m.user_id=u.id and u.active_organization_id is null;
alter table public.companies add column if not exists organization_id uuid;
alter table public.company_sources add column if not exists organization_id uuid;
alter table public.qualification_scores add column if not exists organization_id uuid;
alter table public.email_drafts add column if not exists organization_id uuid;
alter table public.email_events add column if not exists organization_id uuid;
alter table public.conversations add column if not exists organization_id uuid;
alter table public.messages add column if not exists organization_id uuid;
alter table public.calendar_slots add column if not exists organization_id uuid;
alter table public.bookings add column if not exists organization_id uuid;
alter table public.suppressed_contacts add column if not exists organization_id uuid;
alter table public.audit_logs add column if not exists organization_id uuid;
alter table public.discovery_candidates add column if not exists organization_id uuid;
alter table public.discovery_candidates drop constraint if exists discovery_candidates_pkey;
-- Existing audit and suppression rows are append-only at runtime. Pause only
-- their append-only triggers while backfilling the new tenant metadata, then
-- restore them before the migration commits. If anything fails, the enclosing
-- transaction rolls back and restores the original trigger state.
alter table public.audit_logs disable trigger audit_logs_append_only;
alter table public.suppressed_contacts disable trigger suppressed_contacts_append_only;
alter table public.suppressed_contacts disable trigger suppressed_permanent;
do $$
declare t text;
begin
 foreach t in array array['companies','company_sources','qualification_scores','email_drafts','email_events','conversations','messages','calendar_slots','bookings','suppressed_contacts','audit_logs','discovery_candidates'] loop
  execute format('update public.%I set organization_id=(select id from public.organizations order by created_at,id limit 1) where organization_id is null',t);
  execute format('alter table public.%I alter column organization_id set not null',t);
  execute format('alter table public.%I alter column organization_id set default public.current_organization_id()',t);
  execute format('alter table public.%I add constraint %I foreign key(organization_id) references public.organizations(id) on delete cascade',t,t||'_organization_id_fkey');
  execute format('create index if not exists %I on public.%I(organization_id)',t||'_organization_id_idx',t);
 end loop;
end $$;
alter table public.audit_logs enable trigger audit_logs_append_only;
alter table public.suppressed_contacts enable trigger suppressed_contacts_append_only;
alter table public.suppressed_contacts enable trigger suppressed_permanent;
alter table public.discovery_candidates add constraint discovery_candidates_pkey primary key (organization_id,host);
-- These are the deduplication keys used by the application. Resolve any
-- pre-existing duplicates before rollout; see the preflight SQL in the guide.
create unique index companies_org_website_unique on public.companies(organization_id,website);
create unique index company_sources_org_fact_unique on public.company_sources(organization_id,company_id,md5(source_url||chr(31)||claim));
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select p_org is not null and exists(select 1 from public.organization_memberships m where m.organization_id=p_org and m.user_id=auth.uid()) $$;
create or replace function public.has_org_role(p_org uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select p_org is not null and exists(select 1 from public.organization_memberships m where m.organization_id=p_org and m.user_id=auth.uid() and m.role=any(p_roles)) $$;
create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_org uuid; v_name text:=btrim(coalesce(p_name,''));
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(v_name)<2 or length(v_name)>120 then raise exception 'Organization name must be 2 to 120 characters'; end if;
 insert into public.organizations(name) values(v_name) returning id into v_org;
 insert into public.organization_memberships(organization_id,user_id,role) values(v_org,auth.uid(),'owner');
 update public.users set active_organization_id=v_org where id=auth.uid();
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,detail)
 values(auth.uid(),'organization_created','organization',v_org,jsonb_build_object('name',v_name));
 return v_org;
end $$;
create or replace function public.switch_organization(p_org uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
begin
 if auth.uid() is null or not public.is_org_member(p_org) then raise exception 'Organization membership required'; end if;
 update public.users set active_organization_id=p_org where id=auth.uid();
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,detail)
 values(auth.uid(),'organization_switched','organization',p_org,'{}'::jsonb);
 return true;
end $$;
create or replace function public.invite_organization_member(p_email text,p_role text)
returns table(result text,invitation_id uuid)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_org uuid:=public.current_organization_id(); v_email text:=lower(trim(coalesce(p_email,''))); v_user uuid; v_invite uuid;
begin
 if auth.uid() is null or not public.has_org_role(v_org,array['owner','admin']) then raise exception 'Organization admin permission required'; end if;
 if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Valid email required'; end if;
 if p_role not in ('admin','member','viewer') then raise exception 'Invalid membership role'; end if;
 if p_role='admin' and not public.has_org_role(v_org,array['owner']) then raise exception 'Only the owner can invite an admin'; end if;
 select id into v_user from auth.users where lower(email)=v_email limit 1;
 if v_user is not null then
   if exists(select 1 from public.organization_memberships m where m.organization_id=v_org and m.user_id=v_user) then
     return query select 'already_member'::text,null::uuid; return;
   end if;
   insert into public.organization_memberships(organization_id,user_id,role) values(v_org,v_user,p_role);
   update public.users set active_organization_id=v_org where id=v_user and active_organization_id is null;
   insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,detail)
   values(v_org,auth.uid(),'organization_member_added','user',v_user,jsonb_build_object('role',p_role,'email',v_email));
   return query select 'added'::text,null::uuid; return;
 end if;
 insert into public.organization_invitations(organization_id,email,role,invited_by)
 values(v_org,v_email,p_role,auth.uid())
 on conflict(organization_id,email) do update set role=excluded.role,invited_by=excluded.invited_by,created_at=now(),accepted_at=null
 returning id into v_invite;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,detail)
 values(v_org,auth.uid(),'organization_invitation_created','organization_invitation',v_invite,jsonb_build_object('email',v_email,'role',p_role));
 return query select 'invite'::text,v_invite;
end $$;
create or replace function public.cancel_organization_invitation(p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_org uuid:=public.current_organization_id(); v_email text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select email into v_email from public.organization_invitations
 where id=p_invitation_id and organization_id=v_org and accepted_at is null;
 delete from public.organization_invitations i
 where i.id=p_invitation_id and i.organization_id=v_org
   and i.accepted_at is null and public.has_org_role(i.organization_id,array['owner','admin']);
 if found then
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,detail)
  values(auth.uid(),'organization_invitation_cancelled','organization_invitation',p_invitation_id,jsonb_build_object('email',v_email));
 end if;
 return found;
end $$;
create or replace function public.set_organization_member_role(p_user_id uuid,p_role text)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_org uuid:=public.current_organization_id(); v_target_role text;
begin
 if auth.uid() is null or not public.has_org_role(v_org,array['owner','admin']) then raise exception 'Organization admin permission required'; end if;
 if p_role not in ('admin','member','viewer') then raise exception 'Invalid role'; end if;
 select role into v_target_role from public.organization_memberships where organization_id=v_org and user_id=p_user_id for update;
 if not found then raise exception 'Member not found'; end if;
 if v_target_role='owner' then raise exception 'Transfer ownership before changing the owner role'; end if;
 if not public.has_org_role(v_org,array['owner']) and p_role='admin' then raise exception 'Only the owner can grant admin access'; end if;
 update public.organization_memberships set role=p_role where organization_id=v_org and user_id=p_user_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,detail)
 values(auth.uid(),'organization_member_role_changed','user',p_user_id,jsonb_build_object('previous_role',v_target_role,'role',p_role));
 return true;
end $$;
create or replace function public.remove_organization_member(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_org uuid:=public.current_organization_id(); v_target_role text;
begin
 if auth.uid() is null or not public.has_org_role(v_org,array['owner','admin']) then raise exception 'Organization admin permission required'; end if;
 select role into v_target_role from public.organization_memberships where organization_id=v_org and user_id=p_user_id for update;
 if not found then return false; end if;
 if v_target_role='owner' then raise exception 'Transfer ownership before removing the owner'; end if;
 if v_target_role='admin' and not public.has_org_role(v_org,array['owner']) then raise exception 'Only the owner can remove an admin'; end if;
 delete from public.organization_memberships where organization_id=v_org and user_id=p_user_id;
 update public.users set active_organization_id=null where id=p_user_id and active_organization_id=v_org;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,detail)
 values(auth.uid(),'organization_member_removed','user',p_user_id,jsonb_build_object('previous_role',v_target_role));
 return true;
end $$;
-- Conservative shared-provider caps until subscription plans and per-tenant
-- provider credentials are implemented. Limits are enforced atomically in DB.
create or replace function public.consume_organization_quota(p_meter text)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_org uuid:=public.current_organization_id(); v_limit integer; v_quantity integer;
begin
 if auth.uid() is null or not public.has_org_role(v_org,array['owner','admin','member']) then raise exception 'Organization write permission required'; end if;
 v_limit:=case p_meter when 'discovery' then 2 when 'ai_generation' then 40 else null end;
 if v_limit is null then raise exception 'Unknown usage meter'; end if;
 insert into public.organization_usage(organization_id,meter,usage_date,quantity)
 values(v_org,p_meter,current_date,1)
 on conflict(organization_id,meter,usage_date) do update
   set quantity=public.organization_usage.quantity+1,updated_at=now()
   where public.organization_usage.quantity < v_limit
 returning quantity into v_quantity;
 return found;
end $$;
-- Applies even to SECURITY DEFINER routines, keeping mutations in the caller's active organization.
create or replace function public.enforce_row_tenant()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare
 v_org uuid;
 v_valid boolean;
begin
 if tg_op='DELETE' then v_org:=old.organization_id; else v_org:=new.organization_id; end if;
 if v_org is distinct from public.current_organization_id() then raise exception 'Invalid organization context'; end if;
 if not public.has_org_role(v_org,array['owner','admin','member']) then raise exception 'Write permission required'; end if;
 if tg_op='UPDATE' and old.organization_id is distinct from new.organization_id then raise exception 'Organization ownership cannot be changed'; end if;
  if tg_op <> 'DELETE' then
    case tg_table_name
      when 'company_sources' then
        select exists(select 1 from public.companies where id=new.company_id and organization_id=v_org) into v_valid;
      when 'qualification_scores' then
        select exists(select 1 from public.companies where id=new.company_id and organization_id=v_org)
          and (new.source_id is null or exists(select 1 from public.company_sources where id=new.source_id and organization_id=v_org)) into v_valid;
      when 'email_drafts' then
        select exists(select 1 from public.companies where id=new.company_id and organization_id=v_org) into v_valid;
      when 'email_events' then
        select exists(select 1 from public.email_drafts where id=new.draft_id and organization_id=v_org) into v_valid;
      when 'conversations' then
        select exists(select 1 from public.companies where id=new.company_id and organization_id=v_org) into v_valid;
      when 'messages' then
        select exists(select 1 from public.conversations where id=new.conversation_id and organization_id=v_org) into v_valid;
      when 'bookings' then
        select (new.company_id is null or exists(select 1 from public.companies where id=new.company_id and organization_id=v_org))
          and (new.conversation_id is null or exists(select 1 from public.conversations where id=new.conversation_id and organization_id=v_org))
          and (new.slot_id is null or exists(select 1 from public.calendar_slots where id=new.slot_id and organization_id=v_org)) into v_valid;
      when 'suppressed_contacts' then
        select new.source_message_id is null or exists(select 1 from public.messages where id=new.source_message_id and organization_id=v_org) into v_valid;
      else v_valid := true;
    end case;
    if not coalesce(v_valid,false) then raise exception 'Related record belongs to another organization'; end if;
  end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
-- Replace the suppression helpers because the email uniqueness key is now
-- organization scoped. They are SECURITY DEFINER but always use the caller's
-- active tenant and still require an authenticated user for writes.
create or replace function public.is_suppressed(p_email text)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.suppressed_contacts s
  where s.organization_id=public.current_organization_id()
    and lower(s.email)=lower(trim(coalesce(p_email,'')))) $$;
create or replace function public.suppress_contact(p_email text,p_reason text,p_source_message_id uuid default null)
returns public.suppressed_contacts language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_email text:=lower(trim(coalesce(p_email,''))); v_row public.suppressed_contacts;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'Authentication and organization required'; end if;
 if v_email='' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'invalid_email'; end if;
 perform pg_advisory_xact_lock(734921,1);
 insert into public.suppressed_contacts(organization_id,email,reason,source_message_id)
 values(public.current_organization_id(),v_email,coalesce(nullif(trim(p_reason),''),'opt_out'),p_source_message_id)
 on conflict(organization_id,lower(email)) do nothing returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.suppressed_contacts
  where organization_id=public.current_organization_id() and lower(email)=v_email;
  return v_row;
 end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,detail)
 values(public.current_organization_id(),auth.uid(),'contact_suppressed','suppressed_contacts',v_row.id,
   jsonb_build_object('email',v_email,'reason',v_row.reason,'source_message_id',p_source_message_id));
 return v_row;
end $$;
do $$
declare t text;
begin
 foreach t in array array['companies','company_sources','qualification_scores','email_drafts','email_events','conversations','messages','calendar_slots','bookings','suppressed_contacts','audit_logs','discovery_candidates'] loop
  execute format('drop trigger if exists enforce_row_tenant on public.%I',t);
  execute format('create trigger enforce_row_tenant before insert or update or delete on public.%I for each row execute function public.enforce_row_tenant()',t);
 end loop;
end $$;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 insert into public.users(id,email) values(new.id,coalesce(new.email,'')) on conflict(id) do update set email=excluded.email;
 with pending_invites as (
  select id,organization_id,role from public.organization_invitations i
  where lower(i.email)=lower(coalesce(new.email,'')) and i.accepted_at is null
 )
 insert into public.organization_memberships(organization_id,user_id,role)
 select organization_id,new.id,role from pending_invites
 on conflict(organization_id,user_id) do nothing;
 update public.users set active_organization_id=(select organization_id from public.organization_invitations
  where lower(email)=lower(coalesce(new.email,'')) and accepted_at is null order by created_at limit 1)
 where id=new.id and exists(select 1 from public.organization_invitations where lower(email)=lower(coalesce(new.email,'')) and accepted_at is null);
 update public.organization_invitations set accepted_at=now()
 where lower(email)=lower(coalesce(new.email,'')) and accepted_at is null;
 return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
drop index if exists public.suppressed_contacts_email_lower_idx;
drop index if exists public.suppressed_email_unique;
create unique index suppressed_contacts_org_email_lower_idx on public.suppressed_contacts(organization_id,lower(email));
do $$
declare r record;
begin
 for r in select schemaname,tablename,policyname from pg_policies
  where schemaname='public' and tablename = any(array['users','companies','company_sources','qualification_scores','email_drafts','email_events','conversations','messages','calendar_slots','bookings','suppressed_contacts','audit_logs','discovery_candidates','organizations','organization_memberships','organization_invitations']) loop
  execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
 end loop;
end $$;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_usage enable row level security;
alter table public.users enable row level security;
create policy org_members_read on public.organizations for select to authenticated using(public.is_org_member(id));
create policy org_admin_update on public.organizations for update to authenticated using(public.has_org_role(id,array['owner','admin'])) with check(public.has_org_role(id,array['owner','admin']));
create policy memberships_read on public.organization_memberships for select to authenticated using(public.is_org_member(organization_id));
create policy invitations_admin_read on public.organization_invitations for select to authenticated using(public.has_org_role(organization_id,array['owner','admin']));
create policy usage_admin_read on public.organization_usage for select to authenticated using(public.has_org_role(organization_id,array['owner','admin']));
create policy users_self_read on public.users for select to authenticated using(id=auth.uid());
create policy users_org_read on public.users for select to authenticated using(exists(select 1 from public.organization_memberships mine join public.organization_memberships theirs using(organization_id) where mine.user_id=auth.uid() and theirs.user_id=users.id));
do $$
declare t text;
begin
 foreach t in array array['companies','company_sources','qualification_scores','email_drafts','email_events','conversations','messages','calendar_slots','bookings','suppressed_contacts','audit_logs','discovery_candidates'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy tenant_read on public.%I for select to authenticated using(organization_id=public.current_organization_id() and public.is_org_member(organization_id))',t);
  if t not in ('audit_logs','email_events','suppressed_contacts') then
   execute format('create policy tenant_insert on public.%I for insert to authenticated with check(organization_id=public.current_organization_id() and public.has_org_role(organization_id,array[''owner'',''admin'',''member'']))',t);
   execute format('create policy tenant_update on public.%I for update to authenticated using(organization_id=public.current_organization_id() and public.has_org_role(organization_id,array[''owner'',''admin'',''member''])) with check(organization_id=public.current_organization_id() and public.has_org_role(organization_id,array[''owner'',''admin'',''member'']))',t);
  elsif t='email_events' then
   execute format('create policy tenant_insert on public.%I for insert to authenticated with check(organization_id=public.current_organization_id() and public.has_org_role(organization_id,array[''owner'',''admin'',''member'']))',t);
  elsif t='audit_logs' then
   execute format('create policy tenant_insert on public.%I for insert to authenticated with check(organization_id=public.current_organization_id() and actor_id=auth.uid())',t);
  end if;
 end loop;
end $$;
revoke all on all tables in schema public from anon,authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon,authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public,anon,authenticated;
grant usage on schema public to authenticated;
grant select on public.organizations,public.organization_memberships,public.users to authenticated;
grant select on public.organization_invitations,public.organization_usage to authenticated;
grant update(name) on public.organizations to authenticated;
grant select,insert,update on public.companies,public.company_sources,public.qualification_scores,public.email_drafts,public.conversations,public.messages,public.discovery_candidates to authenticated;
grant select on public.calendar_slots,public.bookings to authenticated;
grant select,insert on public.email_events,public.audit_logs to authenticated;
grant select on public.suppressed_contacts to authenticated;
grant execute on function public.create_organization(text),public.switch_organization(uuid) to authenticated;
grant execute on function public.invite_organization_member(text,text),public.cancel_organization_invitation(uuid) to authenticated;
grant execute on function public.set_organization_member_role(uuid,text),public.remove_organization_member(uuid) to authenticated;
grant execute on function public.consume_organization_quota(text) to authenticated;
grant execute on function public.current_organization_id(),public.is_org_member(uuid),public.has_org_role(uuid,text[]) to authenticated;
grant execute on function public.is_suppressed(text),public.suppress_contact(text,text,uuid) to authenticated;
revoke all on function public.create_organization(text),public.switch_organization(uuid) from public,anon;
revoke all on function public.invite_organization_member(text,text),public.cancel_organization_invitation(uuid) from public,anon;
revoke all on function public.set_organization_member_role(uuid,text),public.remove_organization_member(uuid) from public,anon;
revoke all on function public.consume_organization_quota(text) from public,anon;
revoke all on function public.current_organization_id(),public.is_org_member(uuid),public.has_org_role(uuid,text[]) from public,anon;
revoke all on function public.is_suppressed(text),public.suppress_contact(text,text,uuid) from public,anon;
notify pgrst,'reload schema';
commit;

