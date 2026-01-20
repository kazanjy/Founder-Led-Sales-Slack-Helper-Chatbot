import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get the user's license to find their Stripe customer ID
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { license: true },
    });

    const customerId = dbUser?.license?.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json(
        { error: "No subscription found" },
        { status: 404 }
      );
    }

    // Create a portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/chat`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Portal session error:", error);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    );
  }
}
