import type { ClaimType } from "../import-schema";

export type Criterion = {
  key: string;
  label: string;
  measures: string;
  // Which claim_type of sourced rows counts as evidence for this criterion.
  claimType: Exclude<ClaimType, "disqualifier" | "category">;
  // Positive whole number once supplied. null = not set yet.
  weight: number | null;
};

// WEIGHTS ARE INTENTIONALLY BLANK. Fill them in after reviewing the first
// 5 companies on the Prospects page. Until every weight is set, no score
// is computed.
export const CRITERIA: Criterion[] = [
  {
    key: "us_ecommerce",
    label: "US e-commerce presence",
    measures: "Sells online to US customers (Shopify, Amazon, or own site)",
    claimType: "us_ecommerce",
    weight: null,
  },
  {
    key: "size_fit",
    label: "Right size",
    measures: "Sourced evidence of $1M-$10M yearly revenue and 5-50 employees",
    claimType: "size_fit",
    weight: null,
  },
  {
    key: "contact_target",
    label: "Reachable decision-maker",
    measures: "Publicly listed founder, COO, or whoever runs finance",
    claimType: "contact",
    weight: null,
  },
  {
    key: "growth_signal",
    label: "Growth signal",
    measures:
      "Finance/accounting/ops hiring, recent funding, or a new channel (wholesale, Amazon, retail, new countries)",
    claimType: "growth_signal",
    weight: null,
  },
  {
    key: "pain_signal",
    label: "Bookkeeping pain signal",
    measures: "Sourced evidence of bookkeeping or finance-operations strain",
    claimType: "pain_signal",
    weight: null,
  },
];
