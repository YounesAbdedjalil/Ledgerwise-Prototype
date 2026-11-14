"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { isUuid, trimText } from "@/lib/validation";
import {
  canReject,
  canReset,
  canVerify,
  isStructurallyValidSource,
  rejectFields,
  resetFields,
  verifyFields,
} from "@/lib/sources/verification";

export type SourceActionResult = {
  ok: boolean;
  error?: string;
};

type LoadedSource = {
  id: string;
  company_id: string;
  claim: string;
  claim_type: string;
  source_url: string;
  evidence: string;
  verification_status: string;
};

async function loadSource(
  sourceId: string
): Promise<{ source?: LoadedSource; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_sources")
    .select("id,company_id,claim,claim_type,source_url,evidence,verification_status")
    .eq("id", sourceId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Source not found." };
  return { source: data as LoadedSource };
}

function revalidateSourcePages(companyId: string) {
  revalidatePath(`/prospects/${companyId}`);
  revalidatePath("/prospects");
  revalidatePath("/prospects/review");
  revalidatePath("/emails");
}

export async function verifySource(sourceId: string): Promise<SourceActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(sourceId)) return { ok: false, error: "Invalid source ID." };

  const loaded = await loadSource(sourceId);
  if (!loaded.source) return { ok: false, error: loaded.error };

  const { source } = loaded;
  if (!canVerify(source.verification_status)) {
    return { ok: false, error: "This source has an unknown verification state." };
  }
  if (!isStructurallyValidSource(source)) {
    return {
      ok: false,
      error:
        "This source is not structurally usable. It needs a real HTTP(S) URL and quoted evidence before it can be verified.",
    };
  }

  const { data: updated, error } = await supabase
    .from("company_sources")
    .update(verifyFields(user.id, new Date().toISOString()))
    .eq("id", sourceId)
    .eq("verification_status", source.verification_status)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return { ok: false, error: "The source changed while you were reviewing it. Refresh and try again." };
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "source_verified",
    entityType: "company_sources",
    entityId: sourceId,
    detail: {
      company_id: source.company_id,
      previous_status: source.verification_status,
    },
  });

  revalidateSourcePages(source.company_id);
  return { ok: true };
}

export async function rejectSource(
  sourceId: string,
  note: string
): Promise<SourceActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(sourceId)) return { ok: false, error: "Invalid source ID." };

  const cleanNote = trimText(note, 1000);
  if (!cleanNote) {
    return { ok: false, error: "A rejection note is required (maximum 1000 characters)." };
  }

  const loaded = await loadSource(sourceId);
  if (!loaded.source) return { ok: false, error: loaded.error };

  const { source } = loaded;
  if (!canReject(source.verification_status)) {
    return { ok: false, error: "This source has an unknown verification state." };
  }

  const { data: updated, error } = await supabase
    .from("company_sources")
    .update(rejectFields(user.id, new Date().toISOString(), cleanNote))
    .eq("id", sourceId)
    .eq("verification_status", source.verification_status)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return { ok: false, error: "The source changed while you were reviewing it. Refresh and try again." };
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "source_rejected",
    entityType: "company_sources",
    entityId: sourceId,
    detail: {
      company_id: source.company_id,
      previous_status: source.verification_status,
      note: cleanNote,
    },
  });

  revalidateSourcePages(source.company_id);
  return { ok: true };
}

export async function resetSourceToPending(
  sourceId: string,
  reason: string
): Promise<SourceActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(sourceId)) return { ok: false, error: "Invalid source ID." };

  const cleanReason = trimText(reason, 1000);
  if (!cleanReason) {
    return { ok: false, error: "A reason is required (maximum 1000 characters)." };
  }

  const loaded = await loadSource(sourceId);
  if (!loaded.source) return { ok: false, error: loaded.error };

  const { source } = loaded;
  if (!canReset(source.verification_status)) {
    return {
      ok: false,
      error: "Only a verified or rejected source can be reset to pending review.",
    };
  }

  const { data: updated, error } = await supabase
    .from("company_sources")
    .update(resetFields())
    .eq("id", sourceId)
    .eq("verification_status", source.verification_status)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return { ok: false, error: "The source changed while you were reviewing it. Refresh and try again." };
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "source_reset_to_pending",
    entityType: "company_sources",
    entityId: sourceId,
    detail: {
      company_id: source.company_id,
      previous_status: source.verification_status,
      reason: cleanReason,
    },
  });

  revalidateSourcePages(source.company_id);
  return { ok: true };
}