"use server";

import { revalidatePath } from "next/cache";
import { generate } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, type ServerSupabase } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { isSuppressed, suppressContact } from "@/lib/suppression";
import { isValidEmail, isUuid, normalizeEmail, trimText } from "@/lib/validation";
import { isUsableVerifiedContact } from "@/lib/sources/verification";
import {
  buildEmailPrompt,
  buildEmailSystemPrompt,
  fallbackEmailDraft,
  parseEmailDraft,
  selectEmailSources,
  validateEmailDraft,
  type CompanyForEmail,
  type DraftSource,
  type EmailDraftContent,
} from "@/lib/email/draft";

export type EmailActionResult = {
  ok: boolean;
  error?: string;
  draftId?: string;
  conversationId?: string;
  usedFallback?: boolean;
};

type DraftRow = {
  id: string;
  company_id: string;
  subject: string;
  body: string;
  status: string;
  source_ids: string[];
  revision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

const DRAFT_FIELDS =
  "id,company_id,subject,body,status,source_ids,revision_note,reviewed_by,reviewed_at";

const COMPANY_FIELDS =
  "id,name,category,us_ecommerce,growth_signal,contact_name,contact_role,contact_email";

const SOURCE_FIELDS =
  "id,claim,claim_type,source_url,source_title,retrieved_at,evidence,verification_status,reviewed_by,reviewed_at";

function revalidateEmailPages(draftId?: string) {
  revalidatePath("/emails");
  if (draftId) revalidatePath(`/emails/${draftId}`);
  revalidatePath("/conversations");
}

async function loadDraft(
  supabase: ServerSupabase,
  draftId: string
): Promise<{ draft?: DraftRow; error?: string }> {
  const { data, error } = await supabase
    .from("email_drafts")
    .select(DRAFT_FIELDS)
    .eq("id", draftId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Draft not found." };
  return { draft: data as DraftRow };
}

async function checkSuppressed(
  supabase: ServerSupabase,
  email: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (await isSuppressed(supabase, email)) {
      return {
        ok: false,
        error: "This contact is on the permanent suppression list. Do not contact them.",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `${error.message} Apply the database migrations before sending.`
          : "The suppression check failed.",
    };
  }
}

async function composeDraft(
  company: CompanyForEmail,
  sources: DraftSource[],
  context: { revisionNote?: string; previous?: EmailDraftContent } = {}
): Promise<{
  content: EmailDraftContent;
  provider: string;
  model: string;
  attempts: string[];
  usedFallback: boolean;
  fallbackReason?: string;
}> {
  try {
    const response = await generate({
      task: "message",
      system: buildEmailSystemPrompt(),
      prompt: buildEmailPrompt(company, sources, context),
      json: true,
      temperature: 0.3,
      maxTokens: 700,
    });
    const content = parseEmailDraft(response.text);
    const validation = validateEmailDraft(content);
    if (!validation.ok) {
      const reasons = [
        ...validation.issues,
        ...validation.guardrails.map((issue) => issue.message),
      ];
      throw new Error(`The generated draft failed safety checks: ${reasons.join(" ")}`);
    }
    return {
      content,
      provider: response.provider,
      model: response.model,
      attempts: response.attempts,
      usedFallback: false,
    };
  } catch (error) {
    const content = fallbackEmailDraft(company, sources);
    const validation = validateEmailDraft(content);
    if (!validation.ok) {
      throw new Error("No safe draft could be produced from the verified sources.");
    }
    return {
      content,
      provider: "template",
      model: "verified-source-fallback",
      attempts: [],
      usedFallback: true,
      fallbackReason: error instanceof Error ? error.message : "AI unavailable",
    };
  }
}

export async function createDraftForCompany(
  companyId: string
): Promise<EmailActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(companyId)) return { ok: false, error: "Invalid company ID." };

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select(COMPANY_FIELDS)
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) return { ok: false, error: companyError.message };
  if (!company) return { ok: false, error: "Company not found." };

  const typedCompany = company as CompanyForEmail;
  const email = typedCompany.contact_email
    ? normalizeEmail(typedCompany.contact_email)
    : "";
  if (!isValidEmail(email)) {
    return {
      ok: false,
      error: "This company has no usable public contact email. A draft cannot be created.",
    };
  }

  const suppression = await checkSuppressed(supabase, email);
  if (!suppression.ok) return { ok: false, error: suppression.error };

  const { data: sourceData, error: sourceError } = await supabase
    .from("company_sources")
    .select(SOURCE_FIELDS)
    .eq("company_id", companyId);
  if (sourceError) return { ok: false, error: sourceError.message };

  const allSources = (sourceData ?? []) as DraftSource[];
  if (!allSources.some((source) => isUsableVerifiedContact(source, email))) {
    return {
      ok: false,
      error:
        "The recipient contact source has not been human-verified. Verify the contact source in the review queue first.",
    };
  }

  const sources = selectEmailSources(allSources);
  if (sources.length === 0) {
    return {
      ok: false,
      error:
        "No human-verified sources are available for this company. Verify sources in the review queue first.",
    };
  }

  let composed;
  try {
    composed = await composeDraft(typedCompany, sources);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The draft could not be created.",
    };
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("email_drafts")
    .insert({
      company_id: companyId,
      subject: composed.content.subject,
      body: composed.content.body,
      status: "needs_review",
      source_ids: sources.map((source) => source.id),
      revision_note: null,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "The draft could not be saved." };
  }

  await supabase.from("email_events").insert({
    draft_id: inserted.id,
    event_type: "draft_generated",
    actor_id: user.id,
    detail: {
      provider: composed.provider,
      model: composed.model,
      attempts: composed.attempts,
      source_ids: sources.map((source) => source.id),
      used_fallback: composed.usedFallback,
      fallback_reason: composed.fallbackReason ?? null,
    },
  });

  await writeAudit(supabase, {
    actorId: user.id,
    action: "email_draft_generated",
    entityType: "email_drafts",
    entityId: inserted.id,
    detail: {
      company_id: companyId,
      provider: composed.provider,
      model: composed.model,
      used_fallback: composed.usedFallback,
    },
  });

  revalidateEmailPages(inserted.id);
  return {
    ok: true,
    draftId: inserted.id,
    usedFallback: composed.usedFallback,
  };
}

export async function saveDraft(
  draftId: string,
  subject: string,
  body: string
): Promise<EmailActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(draftId)) return { ok: false, error: "Invalid draft ID." };

  const cleanSubject = trimText(subject, 120);
  const cleanBody = trimText(body, 4_000);
  if (!cleanSubject) return { ok: false, error: "A subject is required." };
  if (!cleanBody) return { ok: false, error: "A body is required." };

  const validation = validateEmailDraft({ subject: cleanSubject, body: cleanBody });
  if (!validation.ok) {
    return {
      ok: false,
      error: [...validation.issues, ...validation.guardrails.map((i) => i.message)].join(
        " "
      ),
    };
  }

  const loaded = await loadDraft(supabase, draftId);
  if (!loaded.draft) return { ok: false, error: loaded.error };
  const { draft } = loaded;
  if (draft.status === "sent_simulated" || draft.status === "sent") {
    return { ok: false, error: "A sent draft cannot be edited." };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("email_drafts")
    .update({
      subject: cleanSubject,
      body: cleanBody,
      status: "needs_review",
      reviewed_by: null,
      reviewed_at: null,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("status", draft.status)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "The draft changed while you were editing it. Refresh and try again.",
    };
  }

  await supabase.from("email_events").insert({
    draft_id: draftId,
    event_type: "draft_edited",
    actor_id: user.id,
    detail: {
      previous_status: draft.status,
      previous_subject: draft.subject,
      previous_body: draft.body,
    },
  });

  await writeAudit(supabase, {
    actorId: user.id,
    action: "email_draft_edited",
    entityType: "email_drafts",
    entityId: draftId,
    detail: { company_id: draft.company_id },
  });

  revalidateEmailPages(draftId);
  return { ok: true, draftId };
}

export async function approveDraft(draftId: string): Promise<EmailActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(draftId)) return { ok: false, error: "Invalid draft ID." };

  const loaded = await loadDraft(supabase, draftId);
  if (!loaded.draft) return { ok: false, error: loaded.error };
  const { draft } = loaded;
  if (draft.status !== "draft" && draft.status !== "needs_review") {
    return { ok: false, error: "Only a draft waiting for review can be approved." };
  }

  const validation = validateEmailDraft({ subject: draft.subject, body: draft.body });
  if (!validation.ok) {
    return {
      ok: false,
      error: "This draft still violates a safety rule. Edit it before approving.",
    };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("email_drafts")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("status", draft.status)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "The draft changed while you were reviewing it. Refresh and try again.",
    };
  }

  await supabase.from("email_events").insert({
    draft_id: draftId,
    event_type: "draft_approved",
    actor_id: user.id,
    detail: { previous_status: draft.status },
  });

  await writeAudit(supabase, {
    actorId: user.id,
    action: "email_draft_approved",
    entityType: "email_drafts",
    entityId: draftId,
    detail: { company_id: draft.company_id },
  });

  revalidateEmailPages(draftId);
  return { ok: true, draftId };
}

export async function rejectDraft(
  draftId: string,
  note: string
): Promise<EmailActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(draftId)) return { ok: false, error: "Invalid draft ID." };

  const cleanNote = trimText(note, 1_000);
  if (!cleanNote) return { ok: false, error: "A rejection note is required." };

  const loaded = await loadDraft(supabase, draftId);
  if (!loaded.draft) return { ok: false, error: loaded.error };
  const { draft } = loaded;
  if (draft.status === "sent_simulated" || draft.status === "sent") {
    return { ok: false, error: "A sent draft cannot be rejected." };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("email_drafts")
    .update({
      status: "rejected",
      revision_note: cleanNote,
      reviewed_by: user.id,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("status", draft.status)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "The draft changed while you were reviewing it. Refresh and try again.",
    };
  }

  await supabase.from("email_events").insert({
    draft_id: draftId,
    event_type: "draft_rejected",
    actor_id: user.id,
    detail: { note: cleanNote, previous_status: draft.status },
  });

  await writeAudit(supabase, {
    actorId: user.id,
    action: "email_draft_rejected",
    entityType: "email_drafts",
    entityId: draftId,
    detail: { company_id: draft.company_id, note: cleanNote },
  });

  revalidateEmailPages(draftId);
  return { ok: true, draftId };
}

export async function requestDraftRevision(
  draftId: string,
  note: string
): Promise<EmailActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(draftId)) return { ok: false, error: "Invalid draft ID." };

  const cleanNote = trimText(note, 1_000);
  if (!cleanNote) return { ok: false, error: "Describe the revision you want." };

  const loaded = await loadDraft(supabase, draftId);
  if (!loaded.draft) return { ok: false, error: loaded.error };
  const { draft } = loaded;
  if (draft.status === "sent_simulated" || draft.status === "sent") {
    return { ok: false, error: "A sent draft cannot be revised." };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select(COMPANY_FIELDS)
    .eq("id", draft.company_id)
    .maybeSingle();
  if (companyError) return { ok: false, error: companyError.message };
  if (!company) return { ok: false, error: "Company not found." };

  const { data: sourceData, error: sourceError } = await supabase
    .from("company_sources")
    .select(SOURCE_FIELDS)
    .eq("company_id", draft.company_id);
  if (sourceError) return { ok: false, error: sourceError.message };

  const typedCompany = company as CompanyForEmail;
  const email = typedCompany.contact_email
    ? normalizeEmail(typedCompany.contact_email)
    : "";
  const allSources = (sourceData ?? []) as DraftSource[];
  if (!allSources.some((source) => isUsableVerifiedContact(source, email))) {
    return {
      ok: false,
      error:
        "The recipient contact source is no longer human-verified. Re-verify it before revising.",
    };
  }

  const sourceIds = new Set(draft.source_ids);
  const sources = selectEmailSources(
    allSources.filter((source) => sourceIds.has(source.id))
  );
  if (sources.length === 0) {
    return {
      ok: false,
      error: "The verified sources used by this draft are no longer available.",
    };
  }

  let composed;
  try {
    composed = await composeDraft(company as CompanyForEmail, sources, {
      revisionNote: cleanNote,
      previous: { subject: draft.subject, body: draft.body },
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The revision could not be created.",
    };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("email_drafts")
    .update({
      subject: composed.content.subject,
      body: composed.content.body,
      status: "needs_review",
      revision_note: cleanNote,
      source_ids: sources.map((source) => source.id),
      reviewed_by: null,
      reviewed_at: null,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("status", draft.status)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "The draft changed while you were reviewing it. Refresh and try again.",
    };
  }

  await supabase.from("email_events").insert({
    draft_id: draftId,
    event_type: "draft_revision_requested",
    actor_id: user.id,
    detail: {
      note: cleanNote,
      provider: composed.provider,
      model: composed.model,
      previous_subject: draft.subject,
      previous_body: draft.body,
      used_fallback: composed.usedFallback,
      fallback_reason: composed.fallbackReason ?? null,
    },
  });

  await writeAudit(supabase, {
    actorId: user.id,
    action: "email_draft_revision_requested",
    entityType: "email_drafts",
    entityId: draftId,
    detail: { company_id: draft.company_id, note: cleanNote },
  });

  revalidateEmailPages(draftId);
  return { ok: true, draftId, usedFallback: composed.usedFallback };
}

export async function simulateSendDraft(
  draftId: string
): Promise<EmailActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(draftId)) return { ok: false, error: "Invalid draft ID." };

  const loaded = await loadDraft(supabase, draftId);
  if (!loaded.draft) return { ok: false, error: loaded.error };
  const { draft } = loaded;
  if (draft.status !== "approved") {
    return { ok: false, error: "Only an approved draft can be sent." };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select(COMPANY_FIELDS)
    .eq("id", draft.company_id)
    .maybeSingle();
  if (companyError) return { ok: false, error: companyError.message };
  if (!company) return { ok: false, error: "Company not found." };

  const email = company.contact_email ? normalizeEmail(company.contact_email) : "";
  if (!isValidEmail(email)) {
    return { ok: false, error: "This company has no usable contact email." };
  }

  const suppression = await checkSuppressed(supabase, email);
  if (!suppression.ok) return { ok: false, error: suppression.error };

  const { data: sendSourceData, error: sendSourceError } = await supabase
    .from("company_sources")
    .select(SOURCE_FIELDS)
    .eq("company_id", draft.company_id);
  if (sendSourceError) return { ok: false, error: sendSourceError.message };
  if (
    !(sendSourceData ?? []).some((source) =>
      isUsableVerifiedContact(source as DraftSource, email)
    )
  ) {
    return {
      ok: false,
      error:
        "The recipient contact source is no longer human-verified. Re-verify it before sending.",
    };
  }

  const validation = validateEmailDraft({ subject: draft.subject, body: draft.body });
  if (!validation.ok) {
    return { ok: false, error: "The draft violates a safety rule and cannot be sent." };
  }

  const { data: existingConversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("company_id", draft.company_id)
    .eq("contact_email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let conversationId = existingConversation?.id as string | undefined;
  if (!conversationId) {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .insert({
        company_id: draft.company_id,
        contact_email: email,
        status: "ai_handling",
      })
      .select("id")
      .single();
    if (error || !conversation) {
      return {
        ok: false,
        error: error?.message ?? "The conversation could not be created.",
      };
    }
    conversationId = conversation.id;
  }

  const now = new Date().toISOString();
  const { data: sentDraft, error: updateError } = await supabase
    .from("email_drafts")
    .update({ status: "sent_simulated", updated_at: now })
    .eq("id", draftId)
    .eq("status", "approved")
    .select("id")
    .maybeSingle();
  if (updateError) return { ok: false, error: updateError.message };
  if (!sentDraft) {
    return {
      ok: false,
      error: "The draft changed while you were sending it. Refresh and try again.",
    };
  }

  const { error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender: "ai",
    body: draft.body,
    classification: "first_email",
    needs_review: false,
    guardrail_flags: [],
    is_simulated: true,
    created_at: now,
  });
  if (messageError) {
    await supabase
      .from("email_drafts")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", draftId)
      .eq("status", "sent_simulated");
    return { ok: false, error: messageError.message };
  }

  await supabase.from("email_events").insert({
    draft_id: draftId,
    event_type: "sent_simulated",
    actor_id: user.id,
    detail: {
      conversation_id: conversationId,
      contact_email: email,
      note: "Simulated send: demo path. No real email was sent.",
    },
  });

  await writeAudit(supabase, {
    actorId: user.id,
    action: "email_draft_sent_simulated",
    entityType: "email_drafts",
    entityId: draftId,
    detail: {
      company_id: draft.company_id,
      conversation_id: conversationId,
      contact_email: email,
    },
  });

  revalidateEmailPages(draftId);
  revalidatePath("/conversations");
  revalidatePath(`/conversations/${conversationId}`);
  return { ok: true, draftId, conversationId };
}

// Kept for an explicit human-triggered suppression action on the email screen.
export async function suppressFromDraft(
  draftId: string,
  reason: string
): Promise<EmailActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(draftId)) return { ok: false, error: "Invalid draft ID." };

  const cleanReason = trimText(reason, 500);
  if (!cleanReason) return { ok: false, error: "A suppression reason is required." };

  const loaded = await loadDraft(supabase, draftId);
  if (!loaded.draft) return { ok: false, error: loaded.error };

  const { data: company } = await supabase
    .from("companies")
    .select("contact_email")
    .eq("id", loaded.draft.company_id)
    .maybeSingle();

  const email = company?.contact_email ? normalizeEmail(company.contact_email) : "";
  if (!isValidEmail(email)) {
    return { ok: false, error: "This company has no usable contact email." };
  }

  const result = await suppressContact(supabase, { email, reason: cleanReason });
  if (!result.ok) return { ok: false, error: result.error };

  await writeAudit(supabase, {
    actorId: user.id,
    action: "email_draft_contact_suppressed",
    entityType: "email_drafts",
    entityId: draftId,
    detail: { company_id: loaded.draft.company_id, email, reason: cleanReason },
  });

  revalidateEmailPages(draftId);
  return { ok: true, draftId };
}