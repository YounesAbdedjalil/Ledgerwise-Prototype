# Ideal Customer Profile (ICP)

Source: Unscale case study, page 2. Confirmed.

## Who
US e-commerce brands selling online (Shopify, Amazon, or own site).

## Size (confirmed)
- $1M-$10M yearly revenue
- 5-50 employees

## Contact target
Founder, COO, or whoever runs finance.

## Growth signals
- Hiring for finance, accounting, or ops
- Recent funding
- Expanding into new channels: wholesale, Amazon, retail, new countries

## Excluded
- Non-US
- Marketplace-only sellers with no own site
- Outside the $1M-$10M revenue / 5-50 employee band

## Research: what goes in each claim_type

| claim_type | Record |
|---|---|
| `us_ecommerce` | Evidence of a US storefront, US shipping, or US pricing |
| `category` | What the company sells |
| `size_fit` | A sourced statement that the company is inside the band ($1M-$10M revenue, 5-50 employees). Quote the figure the source gives. |
| `growth_signal` | Finance/accounting/ops hiring, funding, or a new channel |
| `pain_signal` | A sourced sign of bookkeeping or finance-ops strain |
| `disqualifier` | Sourced evidence the company is excluded (see above) |
| `contact` | `Name \| Role` or `Name \| Role \| email`, only if publicly listed |

## Rules
- Disqualified companies are recorded as `disqualifier` rows and are never dropped.
  They are the negative test set for scoring.
- Every row needs a source URL, title, retrieval date and evidence.
- A fact that can't be verified is left out and shows as "unknown".
- Size is recorded only when a source states it. In-band evidence is `size_fit`; out-of-band evidence is a `disqualifier`.
