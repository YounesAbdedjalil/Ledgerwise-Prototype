import { extractJson } from "../ai";
import { truncate } from "../validation";
import { scanOutboundMessage, type GuardrailIssue } from "../email/guardrails";
import type { DraftSource } from "../email/draft";
import type { InboundClassification } from "./classify";

export type ThreadMessage = {
  sender: string;
  body: string;
  created_at: string;
};

export type ReplyDraft = { body: string };

export type ReplyValidation = {
  ok: boolean;
  issues: string[];
  guardrails: GuardrailIssue[];
};

export function buildReplySystemPrompt(): string {
  return [
    "You are an AI assistant working with the Ledgerwise sales team.",
    "Reply briefly and calmly to the prospect's latest message.",
    "Use only the verified facts supplied in the JSON input. Never invent company facts.",
    "Never mention price, pricing, cost, fees, rates, discounts, budget, or guarantees.",
    "If the prospect asks whether you are an AI, say clearly that you are an AI assistant.",
    "If anything is uncertain, sensitive, legal, or unusual, do not answer it; a human will follow up.",
    "Do not claim to be human. Do not promise results or outcomes.",
    'Return a single JSON object with exactly one string field: {"body":"..."}',
  ].join("\n");
}

export function buildReplyPrompt(
  classification: InboundClassification,
  messages: ThreadMessage[],
  sources: DraftSource[]
): string {
  return JSON.stringify(
    {
      task: "draft_reply",
      classification: {
        intent: classification.intent,
        reason: classification.reason,
        flags: classification.flags,
      },
      recent_thread: messages.slice(-10).map((message) => ({
        sender: message.sender,
        body: truncate(message.body, 2_000),
        created_at: message.created_at,
      })),
      verified_facts: sources.slice(0, 6).map((source) => ({
        claim_type: source.claim_type,
        claim: source.claim,
        evidence: truncate(source.evidence, 500),
        source_title: source.source_title,
        source_url: source.source_url,
        retrieved_at: source.retrieved_at,
      })),
    },
    null,
    2
  );
}

export function parseReply(text: string): ReplyDraft {
  const parsed = extractJson<{ body?: unknown }>(text);
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (!body) throw new Error("The model did not return a reply body.");
  return { body };
}

export function validateReply(body: string): ReplyValidation {
  const issues: string[] = [];
  if (!body.trim()) issues.push("The reply is empty.");
  if (body.length > 2_000) issues.push("The reply must be 2000 characters or fewer.");
  if (/\{\{|\}\}|\[insert|\bTBD\b/i.test(body)) {
    issues.push("The reply contains an unresolved placeholder.");
  }
  const guardrails = scanOutboundMessage(body);
  return { ok: issues.length === 0 && guardrails.length === 0, issues, guardrails };
}

export function botDisclosureReply(): string {
  return "Yes — I'm an AI assistant working with the Ledgerwise team. A human teammate can take over at any point. Is there something specific I can help route to them?";
}

export function fallbackReply(classification: InboundClassification): string {
  if (classification.intent === "bot_question") return botDisclosureReply();
  return "Thanks for getting back to me. A member of the Ledgerwise team will follow up shortly.";
}