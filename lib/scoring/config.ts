import type { ClaimType } from "../import-schema";

export type Criterion = {
  key: string;
  label: string;
  measures: string;
  claimType: Exclude<ClaimType, "disqualifier" | "category">;
  weight: number | null;
};

export const CRITERIA: Criterion[] = [
  {
    key: "us_ecommerce",
    label: "US e-commerce presence",
    measures: "Sells online to US customers (Shopify, Amazon, or own site)",
    claimType: "us_ecommerce",
    weight: 30,
  },
  {
    key: "size_fit",
    label: "Revenue and employee-size fit",
    measures: "Sourced evidence of $1M-$10M yearly revenue and 5-50 employees",
    claimType: "size_fit",
    weight: 25,
  },
  {
    key: "contact_target",
    label: "Reachable decision-maker",
    measures: "Publicly listed founder, COO, or whoever runs finance",
    claimType: "contact",
    weight: 15,
  },
  {
    key: "growth_signal",
    label: "Growth signal",
    measures:
      "Finance/accounting/ops hiring, recent funding, or a new channel (wholesale, Amazon, retail, new countries)",
    claimType: "growth_signal",
    weight: 15,
  },
  {
    key: "pain_signal",
    label: "Bookkeeping pain signal",
    measures: "Sourced evidence of bookkeeping or finance-operations strain",
    claimType: "pain_signal",
    weight: 15,
  },
];
