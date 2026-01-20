import Stripe from "stripe";

// Lazy initialization to avoid build-time errors when env vars aren't set
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-12-15.clover",
      typescript: true,
    });
  }
  return _stripe;
}

// For backwards compatibility - will throw at runtime if not configured
export const stripe = {
  get checkout() { return getStripe().checkout; },
  get customers() { return getStripe().customers; },
  get subscriptions() { return getStripe().subscriptions; },
  get billingPortal() { return getStripe().billingPortal; },
  get webhooks() { return getStripe().webhooks; },
};

// Price IDs - set these after creating products in Stripe Dashboard
export const PRICES = {
  MONTHLY: process.env.STRIPE_PRICE_MONTHLY_ID || "",
  ANNUAL: process.env.STRIPE_PRICE_ANNUAL_ID || "",
};

// Pricing display values
export const PRICING = {
  MONTHLY: {
    amount: 99,
    interval: "month" as const,
    label: "$99/month",
  },
  ANNUAL: {
    amount: 828, // $69 x 12
    monthlyEquivalent: 69,
    interval: "year" as const,
    label: "$69/month",
    sublabel: "billed annually ($828)",
    savings: "Save 30%",
  },
};
