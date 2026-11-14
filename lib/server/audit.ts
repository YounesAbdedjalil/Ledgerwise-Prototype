import type { ServerSupabase } from "./auth";

export type AuditRecord = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
};

export type AuditResult = { ok: true } | { ok: false; error: string };

export async function writeAudit(
  supabase: ServerSupabase,
  record: AuditRecord
): Promise<AuditResult> {
  const { error } = await supabase.from("audit_logs").insert({
    actor_id: record.actorId ?? null,
    action: record.action,
    entity_type: record.entityType,
    entity_id: record.entityId ?? null,
    detail: record.detail ?? {},
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}