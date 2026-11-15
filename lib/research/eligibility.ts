export type EligibilityPage = {
  title: string;
  text: string;
};

export type EcommerceEligibility = {
  eligible: boolean;
  reason: string;
  commerceSignals: string[];
  serviceSignals: string[];
};

const COMMERCE_SIGNAL_GROUPS: {
  label: string;
  patterns: RegExp[];
}[] = [
  {
    label: "transaction controls",
    patterns: [
      /\badd to (?:cart|bag)\b/i,
      /\bbuy now\b/i,
      /\bproceed to checkout\b/i,
      /\bshopping cart\b/i,
      /\bquick add\b/i,
      /\bcheckout\b/i,
    ],
  },
  {
    label: "product catalog",
    patterns: [
      /\bproduct details\b/i,
      /\bproduct variants\b/i,
      /\bshop all\b/i,
      /\bshop by\b/i,
      /\bin stock\b/i,
      /\bout of stock\b/i,
      /\bSKU\b/i,
      /\bcollections?\b/i,
    ],
  },
  {
    label: "e-commerce platform evidence",
    patterns: [
      /\bcdn\.shopify\.com\b/i,
      /\b[a-z0-9-]+\.myshopify\.com\b/i,
      /\bshopify-payment-button\b/i,
      /\bwoocommerce\b/i,
      /\bbigcommerce\b/i,
      /\bmagento\b/i,
      /\bsquarespace commerce\b/i,
    ],
  },
];

const SERVICE_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "bookkeeping services", pattern: /\bbookkeeping services?\b/i },
  { label: "accounting services", pattern: /\baccounting services?\b/i },
  { label: "CFO or fractional CFO services", pattern: /\b(?:fractional\s+)?CFO services?\b/i },
  { label: "consulting", pattern: /\bconsult(?:ing|ancy)\b/i },
  { label: "agency services", pattern: /\bagenc(?:y|ies)\b/i },
  { label: "SaaS or software platform", pattern: /\b(?:SaaS|software as a service|software platform)\b/i },
  { label: "web development services", pattern: /\bweb development services?\b/i },
  { label: "marketing services", pattern: /\bmarketing services?\b/i },
];

export function assessEcommerceEligibility(
  pages: EligibilityPage[],
): EcommerceEligibility {
  const content = pages
    .map((page) => `${page.title}\n${page.text}`)
    .join("\n")
    .normalize("NFKC")
    .toLowerCase();

  const commerceSignals = COMMERCE_SIGNAL_GROUPS
    .filter((group) => group.patterns.some((pattern) => pattern.test(content)))
    .map((group) => group.label);

  const serviceSignals = SERVICE_PATTERNS
    .filter(({ pattern }) => pattern.test(content))
    .map(({ label }) => label);

  const hasTransactionSignal = commerceSignals.includes("transaction controls");
  const hasPlatformSignal = commerceSignals.includes("e-commerce platform evidence");
  const enoughCommerceEvidence =
    commerceSignals.length >= 2 && (hasTransactionSignal || hasPlatformSignal);

  if (!enoughCommerceEvidence) {
    return {
      eligible: false,
      reason:
        "No sufficient first-party online-store evidence. Discovery requires at least two independent storefront signals, including transaction or e-commerce platform evidence.",
      commerceSignals,
      serviceSignals,
    };
  }

  const specialistServiceSignals = serviceSignals.filter((signal) =>
    [
      "bookkeeping services",
      "accounting services",
      "CFO or fractional CFO services",
      "SaaS or software platform",
    ].includes(signal)
  );

  const agencyLed =
    serviceSignals.includes("agency services") &&
    (
      serviceSignals.includes("marketing services") ||
      serviceSignals.includes("web development services")
    );

  if (specialistServiceSignals.length > 0 || agencyLed) {
    return {
      eligible: false,
      reason:
        "The available first-party evidence indicates a service-led business rather than a clearly established e-commerce retailer.",
      commerceSignals,
      serviceSignals,
    };
  }

  return {
    eligible: true,
    reason: "Multiple first-party storefront signals were found.",
    commerceSignals,
    serviceSignals,
  };
}
