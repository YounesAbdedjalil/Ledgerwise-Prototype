import { extractJson } from "../ai";
import { truncate } from "../validation";
import {
  isUsableVerifiedSource,
  type SourceLike,
} from "../sources/verification";
import { scanOutboundMessage, type GuardrailIssue } from "./guardrails";

export type DraftSource = SourceLike & {
  id: string;
  source_title: string;
  source_url: string;
  retrieved_at: string;
};

export type CompanyForEmail = {
  id: string;
  name: string;
  category: string;
  us_ecommerce: string;
  growth_signal: string;
  contact_name: string;
  contact_role: string;
  contact_email: string | null;
};

export type EmailDraftContent = {
  subject: string;
  body: string;
};

export type DraftValidation = {
  ok: boolean;
  issues: string[];
  guardrails: GuardrailIssue[];
};

const MAX_SUBJECT = 120;
const MAX_BODY = 4_000;
const MAX_SOURCES = 6;

export function selectEmailSources<T extends DraftSource>(sources: T[]): T[] {
  return sources
    .filter((source) => isUsableVerifiedSource(source))
    .slice(0, MAX_SOURCES);
}

export function contactFirstName(contactName: string): string {
  const name = contactName.trim();
  if (!name || name.toLowerCase() === "unknown") return "there";
  return name.split(/\s+/)[0];
}

export function buildSourceFacts(sources: DraftSource[]) {
  return sources.map((source) => ({
    id: source.id,
    claim_type: source.claim_type,
    claim: source.claim,
    evidence: truncate(source.evidence, 500),
    source_title: source.source_title,
    source_url: source.source_url,
    retrieved_at: source.retrieved_at,
  }));
}

export function buildEmailSystemPrompt(): string {
  return [
    "You write short first emails for Ledgerwise, a bookkeeping company serving US e-commerce brands.",
    "Use ONLY the verified facts supplied in the JSON input. If a fact is not in the input, do not mention it.",
    "Never mention price, pricing, cost, fees, rates, discounts, budget, or guarantees.",
    "Never invent company facts, revenue, employee counts, funding, contact details, or prior conversations.",
    "Do not claim to be human. Introduce yourself as an AI assistant working with the Ledgerwise team.",
    "Keep the body under 140 words, specific, calm, and easy to decline.",
    'Return a single JSON object with exactly two string fields: {"subject":"...","body":"..."}',
  ].join("\n");
}

export function buildEmailPrompt(
  company: CompanyForEmail,
  sources: DraftSource[],
  context: { revisionNote?: string; previous?: EmailDraftContent } = {}
): string {
  return JSON.stringify(
    {
      task: "write_first_email",
      company: {
        name: company.name,
        category: company.category,
        us_ecommerce: company.us_ecommerce,
        growth_signal: company.growth_signal,
        contact_first_name: contactFirstName(company.contact_name),
        contact_role: company.contact_role,
      },
      verified_facts: buildSourceFacts(sources),
      revision_note: context.revisionNote ?? null,
      previous_draft: context.previous ?? null,
    },
    null,
    2
  );
}

export function parseEmailDraft(text: string): EmailDraftContent {
  const parsed = extractJson<{ subject?: unknown; body?: unknown }>(text);
  const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (!subject || !body) {
    throw new Error("The model did not return a subject and body.");
  }
  return { subject, body };
}

export function validateEmailDraft(draft: EmailDraftContent): DraftValidation {
  const issues: string[] = [];
  if (!draft.subject.trim()) issues.push("The subject is empty.");
  if (draft.subject.length > MAX_SUBJECT)
    issues.push(`The subject must be ${MAX_SUBJECT} characters or fewer.`);
  if (!draft.body.trim()) issues.push("The body is empty.");
  if (draft.body.length > MAX_BODY)
    issues.push(`The body must be ${MAX_BODY} characters or fewer.`);
  if (/\{\{|\}\}|\[insert|\[company|\[name\]|\bTBD\b/i.test(draft.body)) {
    issues.push("The draft contains an unresolved placeholder.");
  }
  const guardrails = scanOutboundMessage(`${draft.subject}\n${draft.body}`);
  return { ok: issues.length === 0 && guardrails.length === 0, issues, guardrails };
}

export function fallbackEmailDraft(
  company: CompanyForEmail,
  sources: DraftSource[]
): EmailDraftContent {
  const facts = sources.slice(0, 2).map((source) => source.claim.replace(/[.!?]+$/, ""));
  const firstName = contactFirstName(company.contact_name);
  const greeting = firstName === "there" ? "Hi there," : `Hi ${firstName},`;
  const factLines = facts.map((fact) => `- ${fact}`).join("\n");
  const paragraphs = [
    greeting,
    "I'm an AI assistant working with the Ledgerwise team. We help US e-commerce brands keep their books accurate as they grow.",
    factLines ? `I noticed from public sources that:\n${factLines}` : null,
    "Would a short call be useful to see whether we can help? If not, no problem at all.",
  ].filter((part): part is string => Boolean(part));
  const body = [...paragraphs, "Best,\nLedgerwise team"].join("\n\n");

  return {
    subject: `Quick question about ${company.name}`.slice(0, MAX_SUBJECT),
    body: body.slice(0, MAX_BODY),
  };
}