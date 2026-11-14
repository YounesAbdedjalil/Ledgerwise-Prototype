"use server";

import { revalidatePath } from "next/cache";
import { generate } from "@/lib/ai";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, type ServerSupabase } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { isSuppressed, suppressContact } from "@/lib/suppression";
import { isUuid, trimText } from "@/lib/validation";
import { selectEmailSources, type DraftSource } from "@/lib/email/draft";
import {
  classifyInboundMessage,
  type InboundClassification,
} from "@/lib/conversations/classify";
import {
  botDisclosureReply,
  buildReplyPrompt,
  buildReplySystemPrompt,
  fallbackReply,
  parseReply,
  validateReply,
} from "@/lib/conversations/reply";

export type ConversationActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  conversationId?: string;
  messageId?: string;
};

type ConversationRow = {
  id: string;
  company_id: string;
  contact_email: string;
  status: string;
  booking_request: boolean;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender: string;
  body: string;
  needs_review: boolean;
  created_at: string;
};

const CONVERSATION_FIELDS = "id,company_id,contact_email,status,booking_request";

function revalidateConversation(conversationId: string) {
  revalidatePath("/conversations");
  revalidatePath(`/conversations/${conversationId}`);
}

async function loadConversation(
  supabase: ServerSupabase,
  conversationId: string
): Promise<{ conversation?: ConversationRow; error?: string }> {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_FIELDS)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) {
    return {
      error:
        `${error.message} Apply the database migrations before using conversations.`,
    };
  }
  if (!data) return { error: "Conversation not found." };
  return { conversation: data as ConversationRow };
}

async function checkContactSuppression(
  supabase: ServerSupabase,
  email: string
): Promise<{ ok: boolean; suppressed: boolean; error?: string }> {
  try {
    return { ok: true, suppressed: await isSuppressed(supabase, email) };
  } catch (error) {
    return {
      ok: false,
      suppressed: false,
      error:
        error instanceof Error
          ? `${error.message} Apply the database migrations before replying.`
          : "The suppression check failed.",
    };
  }
}

async function loadCompanySources(
  supabase: ServerSupabase,
  companyId: string
): Promise<DraftSource[]> {
  const { data } = await supabase
    .from("company_sources")
    .select(
      "id,claim,claim_type,source_url,source_title,retrieved_at,evidence,verification_status,reviewed_by,reviewed_at"
    )
    .eq("company_id", companyId);
  return selectEmailSources((data ?? []) as DraftSource[]);
}

async function composeReply(
  classification: InboundClassification,
  messages: MessageRow[],
  sources: DraftSource[]
): Promise<{
  body: string;
  provider: string;
  model: string;
  usedFallback: boolean;
  fallbackReason?: string;
}> {
  if (classification.intent === "bot_question") {
    return {
      body: botDisclosureReply(),
      provider: "rules",
      model: "bot-disclosure",
      usedFallback: false,
    };
  }

  try {
    const response = await generate({
      task: "message",
      system: buildReplySystemPrompt(),
      prompt: buildReplyPrompt(
        classification,
        messages.map((message) => ({
          sender: message.sender,
          body: message.body,
          created_at: message.created_at,
        })),
        sources
      ),
      json: true,
      temperature: 0.3,
      maxTokens: 500,
    });
    const reply = parseReply(response.text);
    const validation = validateReply(reply.body);
    if (!validation.ok) {
      throw new Error(
        `The generated reply failed safety checks: ${[
          ...validation.issues,
          ...validation.guardrails.map((issue) => issue.message),
        ].join(" ")}`
      );
    }
    return {
      body: reply.body,
      provider: response.provider,
      model: response.model,
      usedFallback: false,
    };
  } catch (error) {
    const body = fallbackReply(classification);
    const validation = validateReply(body);
    if (!validation.ok) {
      throw new Error("No safe reply could be produced.");
    }
    return {
      body,
      provider: "template",
      model: "safe-fallback",
      usedFallback: true,
      fallbackReason: error instanceof Error ? error.message : "AI unavailable",
    };
  }
}

export async function addProspectReply(
  conversationId: string,
  body: string
): Promise<ConversationActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(conversationId)) return { ok: false, error: "Invalid conversation ID." };

  const cleanBody = trimText(body, 4_000);
  if (!cleanBody) return { ok: false, error: "The prospect message is empty or too long." };

  const loaded = await loadConversation(supabase, conversationId);
  if (!loaded.conversation) return { ok: false, error: loaded.error };
  const { conversation } = loaded;

  const classification = classifyInboundMessage(cleanBody);

  const { data: inserted, error: messageError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender: "prospect",
      body: cleanBody,
      classification: classification.intent,
      needs_review: false,
      guardrail_flags: classification.flags,
      is_simulated: true,
    })
    .select("id")
    .single();
  if (messageError || !inserted) {
    return {
      ok: false,
      error: messageError?.message ?? "The prospect message could not be saved.",
    };
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "prospect_message_recorded",
    entityType: "messages",
    entityId: inserted.id,
    detail: {
      conversation_id: conversationId,
      classification: classification.intent,
      flags: classification.flags,
    },
  });

  let suppressed = conversation.status === "suppressed";
  if (!suppressed) {
    const suppression = await checkContactSuppression(
      supabase,
      conversation.contact_email
    );
    if (!suppression.ok) {
      await supabase
        .from("conversations")
        .update({ status: "needs_human", booking_request: false })
        .eq("id", conversationId);
      await writeAudit(supabase, {
        actorId: user.id,
        action: "suppression_check_failed",
        entityType: "conversations",
        entityId: conversationId,
        detail: { note: suppression.error },
      });
      revalidateConversation(conversationId);
      return {
        ok: false,
        conversationId,
        messageId: inserted.id,
        error: suppression.error,
      };
    }
    suppressed = suppression.suppressed;
  }

  if (suppressed) {
    if (conversation.status !== "suppressed") {
      await supabase
        .from("conversations")
        .update({ status: "suppressed", booking_request: false })
        .eq("id", conversationId);
      await writeAudit(supabase, {
        actorId: user.id,
        action: "conversation_suppressed_from_existing_opt_out",
        entityType: "conversations",
        entityId: conversationId,
        detail: { email: conversation.contact_email },
      });
    }
    await writeAudit(supabase, {
      actorId: user.id,
      action: "message_after_suppression",
      entityType: "conversations",
      entityId: conversationId,
      detail: { note: "Recorded inbound message. No reply was generated." },
    });
    revalidateConversation(conversationId);
    return {
      ok: true,
      conversationId,
      messageId: inserted.id,
      message: "The contact is suppressed. The message was recorded and no reply was generated.",
    };
  }

  if (classification.suppress) {
    const suppression = await suppressContact(supabase, {
      email: conversation.contact_email,
      reason: "opt_out",
      sourceMessageId: inserted.id,
    });
    if (!suppression.ok) {
      await supabase
        .from("conversations")
        .update({ status: "needs_human" })
        .eq("id", conversationId);
      revalidateConversation(conversationId);
      return {
        ok: false,
        error: `Opt-out detected but suppression failed: ${suppression.error}`,
      };
    }

    await supabase
      .from("conversations")
      .update({ status: "suppressed", booking_request: false })
      .eq("id", conversationId);

    await writeAudit(supabase, {
      actorId: user.id,
      action: "conversation_suppressed_by_opt_out",
      entityType: "conversations",
      entityId: conversationId,
      detail: {
        email: conversation.contact_email,
        source_message_id: inserted.id,
      },
    });

    revalidateConversation(conversationId);
    return {
      ok: true,
      conversationId,
      messageId: inserted.id,
      message: "Opt-out detected. The contact is permanently suppressed and no reply was sent.",
    };
  }

  if (classification.bookingRequest) {
    await supabase
      .from("conversations")
      .update({ status: "needs_human", booking_request: true })
      .eq("id", conversationId);
    await writeAudit(supabase, {
      actorId: user.id,
      action: "booking_request_flagged",
      entityType: "conversations",
      entityId: conversationId,
      detail: { source_message_id: inserted.id, note: "No slot held automatically." },
    });
    revalidateConversation(conversationId);
    return {
      ok: true,
      conversationId,
      messageId: inserted.id,
      message: "Booking intent flagged for a human. No slot was held automatically.",
    };
  }

  if (classification.needsHuman) {
    await supabase
      .from("conversations")
      .update({ status: "needs_human" })
      .eq("id", conversationId);
    await writeAudit(supabase, {
      actorId: user.id,
      action: "conversation_escalated",
      entityType: "conversations",
      entityId: conversationId,
      detail: {
        classification: classification.intent,
        reason: classification.reason,
      },
    });
    revalidateConversation(conversationId);
    return {
      ok: true,
      conversationId,
      messageId: inserted.id,
      message: `Escalated: ${classification.reason}`,
    };
  }

  if (
    conversation.status === "human_takeover" ||
    conversation.status === "closed" ||
    conversation.status === "needs_human"
  ) {
    await writeAudit(supabase, {
      actorId: user.id,
      action: "message_waiting_for_human",
      entityType: "conversations",
      entityId: conversationId,
      detail: {
        classification: classification.intent,
        status: conversation.status,
        note: "Message recorded. No AI reply was generated.",
      },
    });
    revalidateConversation(conversationId);
    return {
      ok: true,
      conversationId,
      messageId: inserted.id,
      message: "Message recorded. This thread is waiting for a human, so no AI reply was generated.",
    };
  }

  const sources = await loadCompanySources(supabase, conversation.company_id);
  const { data: thread } = await supabase
    .from("messages")
    .select("id,conversation_id,sender,body,needs_review,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  let composition;
  try {
    composition = await composeReply(
      classification,
      (thread ?? []) as MessageRow[],
      sources
    );
  } catch (error) {
    await supabase
      .from("conversations")
      .update({ status: "needs_human" })
      .eq("id", conversationId);
    revalidateConversation(conversationId);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The reply could not be drafted.",
    };
  }

  const { data: aiMessage, error: aiError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender: "ai",
      body: composition.body,
      classification: classification.intent,
      needs_review: true,
      guardrail_flags: composition.usedFallback ? ["fallback"] : [],
      is_simulated: true,
    })
    .select("id")
    .single();
  if (aiError || !aiMessage) {
    return {
      ok: false,
      error: aiError?.message ?? "The AI draft could not be saved.",
    };
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "ai_reply_drafted",
    entityType: "messages",
    entityId: aiMessage.id,
    detail: {
      conversation_id: conversationId,
      classification: classification.intent,
      provider: composition.provider,
      model: composition.model,
      used_fallback: composition.usedFallback,
      fallback_reason: composition.fallbackReason ?? null,
      needs_review: true,
    },
  });

  revalidateConversation(conversationId);
  return {
    ok: true,
    conversationId,
    messageId: aiMessage.id,
    message: "AI reply drafted. A human must approve it before it counts as sent.",
  };
}

export async function approveAiMessage(
  messageId: string
): Promise<ConversationActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(messageId)) return { ok: false, error: "Invalid message ID." };

  const { data: message, error } = await supabase
    .from("messages")
    .select("id,conversation_id,sender,needs_review,body")
    .eq("id", messageId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!message) return { ok: false, error: "Message not found." };
  if (message.sender !== "ai") {
    return { ok: false, error: "Only AI drafts can be approved." };
  }
  if (!message.needs_review) {
    return { ok: false, error: "This message is already approved." };
  }

  const loaded = await loadConversation(supabase, message.conversation_id);
  if (!loaded.conversation) return { ok: false, error: loaded.error };
  if (loaded.conversation.status === "suppressed") {
    return { ok: false, error: "This contact is suppressed. No reply may be approved." };
  }
  if (loaded.conversation.status === "closed") {
    return { ok: false, error: "This conversation is closed." };
  }

  const suppression = await checkContactSuppression(
    supabase,
    loaded.conversation.contact_email
  );
  if (!suppression.ok) return { ok: false, error: suppression.error };
  if (suppression.suppressed) {
    await supabase
      .from("conversations")
      .update({ status: "suppressed", booking_request: false })
      .eq("id", message.conversation_id);
    await writeAudit(supabase, {
      actorId: user.id,
      action: "ai_reply_blocked_suppressed",
      entityType: "messages",
      entityId: messageId,
      detail: { conversation_id: message.conversation_id },
    });
    revalidateConversation(message.conversation_id);
    return { ok: false, error: "This contact is suppressed. No reply may be approved." };
  }

  const validation = validateReply(message.body);
  if (!validation.ok) {
    return { ok: false, error: "This AI draft still violates a safety rule." };
  }

  const { data: updated, error: updateError } = await supabase
    .from("messages")
    .update({ needs_review: false })
    .eq("id", messageId)
    .eq("needs_review", true)
    .select("id")
    .maybeSingle();
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated) {
    return {
      ok: false,
      error: "This message changed while you were approving it. Refresh and try again.",
    };
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "ai_reply_approved",
    entityType: "messages",
    entityId: messageId,
    detail: { conversation_id: message.conversation_id },
  });

  revalidateConversation(message.conversation_id);
  return {
    ok: true,
    conversationId: message.conversation_id,
    messageId,
    message: "AI reply approved. It is still simulated; no real email was sent.",
  };
}

export async function discardAiMessage(
  messageId: string
): Promise<ConversationActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(messageId)) return { ok: false, error: "Invalid message ID." };

  const { data: message, error } = await supabase
    .from("messages")
    .select("id,conversation_id,sender,needs_review,guardrail_flags")
    .eq("id", messageId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!message) return { ok: false, error: "Message not found." };
  if (message.sender !== "ai" || !message.needs_review) {
    return { ok: false, error: "Only an unapproved AI draft can be discarded." };
  }

  const flags = Array.from(
    new Set([...(message.guardrail_flags ?? []), "discarded"])
  );
  const { data: updated, error: updateError } = await supabase
    .from("messages")
    .update({ needs_review: false, guardrail_flags: flags })
    .eq("id", messageId)
    .eq("needs_review", true)
    .select("id")
    .maybeSingle();
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated) {
    return {
      ok: false,
      error: "This message changed while you were discarding it. Refresh and try again.",
    };
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "ai_reply_discarded",
    entityType: "messages",
    entityId: messageId,
    detail: { conversation_id: message.conversation_id },
  });

  revalidateConversation(message.conversation_id);
  return { ok: true, conversationId: message.conversation_id, messageId };
}

export async function takeoverConversation(
  conversationId: string
): Promise<ConversationActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(conversationId)) return { ok: false, error: "Invalid conversation ID." };

  const loaded = await loadConversation(supabase, conversationId);
  if (!loaded.conversation) return { ok: false, error: loaded.error };
  if (loaded.conversation.status === "suppressed") {
    return { ok: false, error: "A suppressed conversation cannot be taken over." };
  }
  if (loaded.conversation.status === "closed") {
    return {
      ok: false,
      error: "A closed conversation cannot be taken over. Add a new inbound message first.",
    };
  }

  const { error } = await supabase
    .from("conversations")
    .update({ status: "human_takeover", assigned_to: user.id })
    .eq("id", conversationId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(supabase, {
    actorId: user.id,
    action: "conversation_taken_over",
    entityType: "conversations",
    entityId: conversationId,
    detail: {},
  });

  revalidateConversation(conversationId);
  return { ok: true, conversationId, message: "You now control this thread." };
}

export async function sendHumanReply(
  conversationId: string,
  body: string
): Promise<ConversationActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(conversationId)) return { ok: false, error: "Invalid conversation ID." };

  const cleanBody = trimText(body, 4_000);
  if (!cleanBody) return { ok: false, error: "The reply is empty or too long." };

  const loaded = await loadConversation(supabase, conversationId);
  if (!loaded.conversation) return { ok: false, error: loaded.error };
  if (loaded.conversation.status === "suppressed") {
    return { ok: false, error: "This contact is suppressed. Do not reply." };
  }
  if (loaded.conversation.status === "closed") {
    return { ok: false, error: "This conversation is closed. Reopen it before replying." };
  }

  const suppression = await checkContactSuppression(
    supabase,
    loaded.conversation.contact_email
  );
  if (!suppression.ok) return { ok: false, error: suppression.error };
  if (suppression.suppressed) {
    await supabase
      .from("conversations")
      .update({ status: "suppressed", booking_request: false })
      .eq("id", conversationId);
    await writeAudit(supabase, {
      actorId: user.id,
      action: "human_reply_blocked_suppressed",
      entityType: "conversations",
      entityId: conversationId,
      detail: { email: loaded.conversation.contact_email },
    });
    revalidateConversation(conversationId);
    return { ok: false, error: "This contact is suppressed. Do not reply." };
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender: "human",
      body: cleanBody,
      classification: "human_reply",
      needs_review: false,
      guardrail_flags: [],
      is_simulated: true,
    })
    .select("id")
    .single();
  if (error || !message) {
    return { ok: false, error: error?.message ?? "The reply could not be saved." };
  }

  await supabase
    .from("conversations")
    .update({ status: "human_takeover", assigned_to: user.id })
    .eq("id", conversationId);

  await writeAudit(supabase, {
    actorId: user.id,
    action: "human_reply_recorded",
    entityType: "messages",
    entityId: message.id,
    detail: {
      conversation_id: conversationId,
      note: "Simulated send: demo path. No real email was sent.",
    },
  });

  revalidateConversation(conversationId);
  return {
    ok: true,
    conversationId,
    messageId: message.id,
    message: "Human reply recorded as a simulated send.",
  };
}

export async function closeConversation(
  conversationId: string
): Promise<ConversationActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(conversationId)) return { ok: false, error: "Invalid conversation ID." };

  const loaded = await loadConversation(supabase, conversationId);
  if (!loaded.conversation) return { ok: false, error: loaded.error };
  if (loaded.conversation.status === "suppressed") {
    return { ok: false, error: "A suppressed conversation stays closed." };
  }

  const { error } = await supabase
    .from("conversations")
    .update({ status: "closed", booking_request: false })
    .eq("id", conversationId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(supabase, {
    actorId: user.id,
    action: "conversation_closed",
    entityType: "conversations",
    entityId: conversationId,
    detail: {},
  });

  revalidateConversation(conversationId);
  return { ok: true, conversationId, message: "Conversation closed." };
}

export async function suppressConversation(
  conversationId: string,
  reason: string
): Promise<ConversationActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(conversationId)) return { ok: false, error: "Invalid conversation ID." };

  const cleanReason = trimText(reason, 500);
  if (!cleanReason) return { ok: false, error: "A suppression reason is required." };

  const loaded = await loadConversation(supabase, conversationId);
  if (!loaded.conversation) return { ok: false, error: loaded.error };
  const { conversation } = loaded;

  const { data: latestInbound } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("sender", "prospect")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const suppression = await suppressContact(supabase, {
    email: conversation.contact_email,
    reason: cleanReason,
    sourceMessageId: latestInbound?.id ?? null,
  });
  if (!suppression.ok) return { ok: false, error: suppression.error };

  await supabase
    .from("conversations")
    .update({ status: "suppressed", booking_request: false })
    .eq("id", conversationId);

  await writeAudit(supabase, {
    actorId: user.id,
    action: "conversation_suppressed",
    entityType: "conversations",
    entityId: conversationId,
    detail: {
      email: conversation.contact_email,
      reason: cleanReason,
    },
  });

  revalidateConversation(conversationId);
  return {
    ok: true,
    conversationId,
    message: "Contact permanently suppressed. No further contact is allowed.",
  };
}

export async function resolveBookingRequest(
  conversationId: string
): Promise<ConversationActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(conversationId)) return { ok: false, error: "Invalid conversation ID." };

  const loaded = await loadConversation(supabase, conversationId);
  if (!loaded.conversation) return { ok: false, error: loaded.error };

  const { error } = await supabase
    .from("conversations")
    .update({ booking_request: false })
    .eq("id", conversationId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(supabase, {
    actorId: user.id,
    action: "booking_request_resolved",
    entityType: "conversations",
    entityId: conversationId,
    detail: {},
  });

  revalidateConversation(conversationId);
  return { ok: true, conversationId, message: "Booking request cleared." };
}