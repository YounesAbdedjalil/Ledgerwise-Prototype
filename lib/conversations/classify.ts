export type ConversationIntent =
  | "opt_out"
  | "bot_question"
  | "pricing"
  | "legal"
  | "human_request"
  | "sensitive"
  | "booking_request"
  | "general";

export type InboundClassification = {
  intent: ConversationIntent;
  flags: string[];
  suppress: boolean;
  needsHuman: boolean;
  bookingRequest: boolean;
  autoReplyAllowed: boolean;
  reason: string;
};

const OPT_OUT_RE =
  /\b(stop|unsubscribe|opt[ -]?out|remove me|take me off|do not contact|don'?t contact|no more emails|not interested|leave me alone)\b/i;
const BOT_RE =
  /\b(are you (a |an )?(bot|ai|robot|human|real person)|is this (a |an )?(bot|ai|robot)|am i talking to (a |an )?(bot|ai|human|real person)|automated (message|response))\b/i;
const PRICING_RE =
  /\b(price|pricing|cost|costs|how much|quote|fee|fees|rate|rates|discount|budget|monthly)\b/i;
const LEGAL_RE =
  /\b(legal|lawyer|attorney|lawsuit|sue|gdpr|ccpa|contract|terms|privacy policy|compliance)\b/i;
const HUMAN_RE =
  /\b(human|real person|representative|speak to someone|talk to someone|call me|phone me)\b/i;
const SENSITIVE_RE =
  /\b(confidential|sensitive|urgent|emergency|bankruptcy|audit|tax problem|irs|fraud|security incident)\b/i;
const BOOKING_RE =
  /\b(book|booking|schedule|scheduling|calendar|meeting|call|availability|available|time slot|reschedule)\b/i;

export function classifyInboundMessage(text: string): InboundClassification {
  const body = text.trim();

  if (OPT_OUT_RE.test(body)) {
    return {
      intent: "opt_out",
      flags: ["opt_out"],
      suppress: true,
      needsHuman: true,
      bookingRequest: false,
      autoReplyAllowed: false,
      reason: "The prospect asked not to be contacted. Suppress immediately.",
    };
  }

  if (BOT_RE.test(body)) {
    return {
      intent: "bot_question",
      flags: ["bot_disclosure_required"],
      suppress: false,
      needsHuman: false,
      bookingRequest: false,
      autoReplyAllowed: true,
      reason: "The prospect asked whether they are talking to an AI. Disclose honestly.",
    };
  }

  if (PRICING_RE.test(body)) {
    return {
      intent: "pricing",
      flags: ["pricing_escalation"],
      suppress: false,
      needsHuman: true,
      bookingRequest: false,
      autoReplyAllowed: false,
      reason: "Pricing questions must be handled by a human.",
    };
  }

  if (LEGAL_RE.test(body)) {
    return {
      intent: "legal",
      flags: ["legal_escalation"],
      suppress: false,
      needsHuman: true,
      bookingRequest: false,
      autoReplyAllowed: false,
      reason: "Legal or compliance topics must be escalated.",
    };
  }

  if (SENSITIVE_RE.test(body)) {
    return {
      intent: "sensitive",
      flags: ["sensitive_escalation"],
      suppress: false,
      needsHuman: true,
      bookingRequest: false,
      autoReplyAllowed: false,
      reason: "Sensitive or urgent topics must be escalated.",
    };
  }

  if (HUMAN_RE.test(body)) {
    return {
      intent: "human_request",
      flags: ["human_requested"],
      suppress: false,
      needsHuman: true,
      bookingRequest: false,
      autoReplyAllowed: false,
      reason: "The prospect asked for a human. Hand over the thread.",
    };
  }

  if (BOOKING_RE.test(body)) {
    return {
      intent: "booking_request",
      flags: ["booking_request"],
      suppress: false,
      needsHuman: true,
      bookingRequest: true,
      autoReplyAllowed: false,
      reason: "Booking intent is flagged for a human. No slot is held automatically.",
    };
  }

  return {
    intent: "general",
    flags: [],
    suppress: false,
    needsHuman: false,
    bookingRequest: false,
    autoReplyAllowed: true,
    reason: "General reply. A human still reviews the drafted response.",
  };
}