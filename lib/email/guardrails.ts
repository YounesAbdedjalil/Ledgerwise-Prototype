export type GuardrailIssue = {
  code: string;
  message: string;
};

const PRICE_RE =
  /(\$|€|£|\busd\b|\bprice|\bpricing|\bcost|\bcosts|\bfee|\bfees|\bquote|\bquotes|\brates?\b|\bdiscount|\bbudget|\bper month\b|\bmonthly\b)/i;
const PROMISE_RE =
  /\bguarantee|\bguaranteed|\bpromise|\bpromised|\brisk[- ]free|\b100%\b|\bno[- ]risk\b/i;
const HUMAN_CLAIM_RE =
  /\b(i am|i'm|this is) (a |an )?(human|real person|person)\b|\bnot (a |an )?(bot|ai|robot)\b/i;
const PRESSURE_RE =
  /\bact now\b|\blimited time\b|\burgent\b|\blast chance\b|\bdon't miss\b/i;

export function scanOutboundMessage(text: string): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];
  if (PRICE_RE.test(text)) {
    issues.push({
      code: "pricing",
      message:
        "Pricing language is blocked. Never quote, estimate, or discuss price, fees, rates, discounts, or budget in an automated message.",
    });
  }
  if (PROMISE_RE.test(text)) {
    issues.push({
      code: "promise",
      message:
        "Guarantees and promises are blocked. Do not promise results, savings, or outcomes.",
    });
  }
  if (HUMAN_CLAIM_RE.test(text)) {
    issues.push({
      code: "human_claim",
      message:
        "The message claims to be human. The assistant must identify itself as an AI when asked or when introducing itself.",
    });
  }
  if (PRESSURE_RE.test(text)) {
    issues.push({
      code: "pressure",
      message:
        "High-pressure language is blocked. Outreach must be calm and easy to ignore.",
    });
  }
  return issues;
}

export function hasBlockingIssues(issues: GuardrailIssue[]): boolean {
  return issues.length > 0;
}

export function describeIssues(issues: GuardrailIssue[]): string {
  return issues.map((issue) => issue.message).join(" ");
}

export function guardrailCodes(issues: GuardrailIssue[]): string[] {
  return issues.map((issue) => issue.code);
}