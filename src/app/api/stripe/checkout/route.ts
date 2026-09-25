import { NextRequest, NextResponse } from "next/server";
import { stripe, PRICES } from "@/lib/stripe/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { plan } = body; // "monthly" or "annual"

  if (!plan || !["monthly", "annual"].includes(plan)) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const priceId = plan === "monthly" ? PRICES.MONTHLY : PRICES.ANNUAL;

  if (!priceId) {
    return NextResponse.json(
      { error: "Price not configured" },
      { status: 500 }
    );
  }

  try {
    // Get or create Stripe customer
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { license: true },
    });

    let customerId = dbUser?.license?.stripeCustomerId;

    if (!customerId) {
      // Create a new Stripe customer (prefer Google fields, fall back to Slack)
      const customer = await stripe.customers.create({
        email: user.email || user.slackEmail || undefined,
        name: user.name || user.slackUserName || undefined,
        metadata: {
          userId: user.id,
          ...(user.slackUserId && { slackUserId: user.slackUserId }),
          ...(user.googleId && { googleId: user.googleId }),
        },
      });
      customerId = customer.id;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/chat?upgraded=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/upgrade?canceled=true`,
      metadata: {
        userId: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          plan,
        },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
