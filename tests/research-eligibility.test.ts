import test from "node:test";
import assert from "node:assert/strict";
import { assessEcommerceEligibility } from "../lib/research/eligibility";

test("accepts a genuine online retailer with storefront evidence", () => {
  const result = assessEcommerceEligibility([
    {
      title: "Shop",
      text: `
        Shop all products in our collection.
        Product details and product variants are available.
        Add to cart. Proceed to checkout.
      `,
    },
  ]);

  assert.equal(result.eligible, true);
  assert.ok(result.commerceSignals.includes("transaction controls"));
  assert.ok(result.commerceSignals.includes("product catalog"));
});

test("accepts a Shopify storefront with catalog and platform evidence", () => {
  const result = assessEcommerceEligibility([
    {
      title: "Our products",
      text: `
        Browse our collections and product variants.
        This store uses cdn.shopify.com for its storefront.
      `,
    },
  ]);

  assert.equal(result.eligible, true);
});

test("rejects an e-commerce bookkeeping consultancy such as Ecom CFO", () => {
  const result = assessEcommerceEligibility([
    {
      title: "E-commerce accounting and CFO services",
      text: `
        We provide bookkeeping services and accounting services
        for e-commerce businesses. Our fractional CFO consulting
        helps online brands manage their finances.
      `,
    },
  ]);

  assert.equal(result.eligible, false);
  assert.ok(result.serviceSignals.length >= 2);
});

test("rejects an agency that mentions Shopify but has no storefront", () => {
  const result = assessEcommerceEligibility([
    {
      title: "E-commerce growth agency",
      text: `
        We are a marketing agency providing Shopify consulting,
        store optimization, and digital marketing services.
      `,
    },
  ]);

  assert.equal(result.eligible, false);
});

test("rejects a SaaS platform without actual product storefront evidence", () => {
  const result = assessEcommerceEligibility([
    {
      title: "E-commerce software platform",
      text: `
        Our SaaS software platform helps retailers manage orders,
        inventory, and customer relationships.
      `,
    },
  ]);

  assert.equal(result.eligible, false);
});

test("rejects vague retail claims without transaction or platform evidence", () => {
  const result = assessEcommerceEligibility([
    {
      title: "About our brand",
      text: `
        We are a consumer brand offering premium lifestyle products
        and collections for modern customers.
      `,
    },
  ]);

  assert.equal(result.eligible, false);
});

test("does not reject a genuine store merely because it mentions consulting", () => {
  const result = assessEcommerceEligibility([
    {
      title: "Shop our collection",
      text: `
        Browse our product variants and collections.
        Add to cart and proceed to checkout.
        We also publish consulting resources for our customers.
      `,
    },
  ]);

  assert.equal(result.eligible, true);
});
