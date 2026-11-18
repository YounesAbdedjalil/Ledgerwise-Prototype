import type { createClient } from "@/lib/supabase/server";

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export type SessionUser = {
  id: string;
  email: string | null;
};

export async function getSessionUser(
  supabase: ServerSupabase
): Promise<SessionUser | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return { id: user.id, email: user.email ?? null };
}

/** Used by state-changing actions. Viewers can read through RLS but cannot
 * trigger model/provider work or any application mutation. */
export async function getWritableSessionUser(
  supabase: ServerSupabase
): Promise<SessionUser | null> {
  const user = await getSessionUser(supabase);
  if (!user) return null;
  const { data: organizationId, error } = await supabase.rpc("current_organization_id");
  if (error || !organizationId) return null;
  const { data: canWrite, error: roleError } = await supabase.rpc("has_org_role", {
    p_org: organizationId,
    p_roles: ["owner", "admin", "member"],
  });
  if (roleError || !canWrite) return null;
  return user;
}
