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