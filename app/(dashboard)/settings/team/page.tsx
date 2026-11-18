import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/server/auth";
import { cancelInvitation, inviteMember, removeMember, updateMemberRole } from "./actions";

type Search = { status?: string };
const messages: Record<string, string> = {
  invite_sent: "Invitation email sent.", member_added: "Existing user added to the organization.",
  already_member: "That account is already a member.", member_updated: "Member role updated.",
  member_removed: "Member removed.", invite_cancelled: "Invitation cancelled.",
  invalid_email: "Enter a valid email address.", invalid_role: "Choose a valid role.",
  unauthorized: "Sign in again to manage this team.", invite_config: "Set NEXT_PUBLIC_SITE_URL and SUPABASE_SERVICE_ROLE_KEY before inviting a new user.",
  invite_failed: "The invitation could not be sent. Check Supabase Auth email delivery settings.",
  member_update_failed: "The member role could not be changed. Only an owner can grant admin access.",
  member_remove_failed: "The member could not be removed. Owners must transfer ownership first.",
  invite_cancel_failed: "The invitation could not be cancelled.",
};

export default async function TeamSettingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  const { data: activeOrg } = await supabase.rpc("current_organization_id");
  const [{ data: memberships }, { data: invitations }, { data: canManage }, { data: ownMembership }, { status }] = await Promise.all([
    supabase.from("organization_memberships").select("user_id,role,created_at,users(email)").eq("organization_id", activeOrg).order("created_at"),
    supabase.from("organization_invitations").select("id,email,role,created_at").eq("organization_id", activeOrg).is("accepted_at", null).order("created_at"),
    supabase.rpc("has_org_role", { p_org: activeOrg, p_roles: ["owner", "admin"] }),
    supabase.from("organization_memberships").select("role").eq("organization_id", activeOrg).eq("user_id", user?.id ?? "").maybeSingle(),
    searchParams,
  ]);
  const isOwner = ownMembership?.role === "owner";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Team & access</h1>
        <p className="mt-1 text-sm text-slate-600">Manage organization members, invitations, and access levels.</p>
      </header>
      {status && messages[status] && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{messages[status]}</p>}
      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Invite a teammate</h2>
          <form action={inviteMember} className="mt-4 grid gap-3 sm:grid-cols-[1fr_9rem_auto]">
            <input name="email" type="email" required placeholder="teammate@company.com" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <select name="role" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" defaultValue="member">
              <option value="member">Member</option><option value="viewer">Viewer</option><option value="admin">Admin</option>
            </select>
            <button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">Invite</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Owners and admins can invite members. Only the owner can grant admin access.</p>
        </section>
      )}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-5 py-4 font-semibold">Members ({memberships?.length ?? 0})</h2>
        <ul className="divide-y divide-slate-100">
          {(memberships ?? []).map((member) => {
            const profile = Array.isArray(member.users) ? member.users[0] : member.users;
            const isSelf = member.user_id === user?.id;
            return <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div><p className="text-sm font-medium text-slate-900">{profile?.email ?? member.user_id}{isSelf ? " (you)" : ""}</p><p className="text-xs text-slate-500">Joined {new Date(member.created_at).toLocaleDateString()}</p></div>
              {canManage && member.role !== "owner" ? <div className="flex items-center gap-2">
                <form action={updateMemberRole} className="flex items-center gap-2"><input type="hidden" name="user_id" value={member.user_id} /><select name="role" defaultValue={member.role} className="rounded border border-slate-300 px-2 py-1 text-xs"><option value="member">Member</option><option value="viewer">Viewer</option>{isOwner && <option value="admin">Admin</option>}</select><button className="text-xs font-semibold text-blue-700">Save</button></form>
                {!isSelf && <form action={removeMember}><input type="hidden" name="user_id" value={member.user_id} /><button className="text-xs font-semibold text-red-700">Remove</button></form>}
              </div> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-700">{member.role}</span>}
            </li>;
          })}
        </ul>
      </section>
      {!!invitations?.length && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-5 py-4 font-semibold">Pending invitations</h2>
        <ul className="divide-y divide-slate-100">{invitations.map((invite) => <li key={invite.id} className="flex items-center justify-between gap-3 px-5 py-4 text-sm"><span>{invite.email} · <span className="capitalize">{invite.role}</span></span>{canManage && <form action={cancelInvitation}><input type="hidden" name="invitation_id" value={invite.id} /><button className="text-xs font-semibold text-red-700">Cancel</button></form>}</li>)}</ul>
      </section>}
    </div>
  );
}
