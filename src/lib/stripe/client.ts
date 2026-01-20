import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-12-15.clover",
  typescript: true,
});

// Price IDs - set these after creating products in Stripe Dashboard
export const PRICES = {
  MONTHLY: process.env.STRIPE_PRICE_MONTHLY_ID!,
  ANNUAL: process.env.STRIPE_PRICE_ANNUAL_ID!,
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
