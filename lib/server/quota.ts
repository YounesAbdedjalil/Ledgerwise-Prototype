import type { ServerSupabase } from "./auth";

export type OrganizationMeter = "discovery" | "ai_generation";

export async function consumeOrganizationQuota(
  supabase: ServerSupabase,
  meter: OrganizationMeter
): Promise<{ allowed: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("consume_organization_quota", { p_meter: meter });
  if (error) return { allowed: false, error: "Usage limit could not be checked. Try again later." };
  return data
    ? { allowed: true }
    : { allowed: false, error: meter === "discovery" ? "This organization has reached its daily discovery limit." : "This organization has reached its daily AI generation limit." };
}
