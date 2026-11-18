"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/server/auth";

function teamRedirect(status: string): never {
  revalidatePath("/settings/team");
  redirect(`/settings/team?status=${encodeURIComponent(status)}`);
}

export async function inviteMember(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) teamRedirect("invalid_email");
  if (!(["admin", "member", "viewer"] as string[]).includes(role)) teamRedirect("invalid_role");

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) teamRedirect("unauthorized");
  const { data, error } = await supabase.rpc("invite_organization_member", { p_email: email, p_role: role });
  if (error) teamRedirect("invite_failed");
  const outcome = Array.isArray(data) ? data[0] : data;
  if (outcome?.result === "already_member") teamRedirect("already_member");
  if (outcome?.result === "added") teamRedirect("member_added");

  const invitationId = outcome?.invitation_id;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!invitationId || !siteUrl || !serviceKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    if (invitationId) await supabase.rpc("cancel_organization_invitation", { p_invitation_id: invitationId });
    teamRedirect("invite_config");
  }

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/onboarding`,
  });
  if (inviteError) {
    await supabase.rpc("cancel_organization_invitation", { p_invitation_id: invitationId });
    teamRedirect("invite_failed");
  }
  teamRedirect("invite_sent");
}

export async function updateMemberRole(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "");
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) teamRedirect("unauthorized");
  const { error } = await supabase.rpc("set_organization_member_role", { p_user_id: userId, p_role: role });
  teamRedirect(error ? "member_update_failed" : "member_updated");
}

export async function removeMember(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) teamRedirect("unauthorized");
  const { error } = await supabase.rpc("remove_organization_member", { p_user_id: userId });
  teamRedirect(error ? "member_remove_failed" : "member_removed");
}

export async function cancelInvitation(formData: FormData) {
  const invitationId = String(formData.get("invitation_id") ?? "");
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) teamRedirect("unauthorized");
  const { error } = await supabase.rpc("cancel_organization_invitation", { p_invitation_id: invitationId });
  teamRedirect(error ? "invite_cancel_failed" : "invite_cancelled");
}
