import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { prisma } from "@/lib/db";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("No userId in checkout session metadata");
    return;
  }

  const subscriptionId = session.subscription as string;
  const customerId = session.customer as string;
  const plan = session.metadata?.plan || "monthly";

  // Create or update license
  const existingLicense = await prisma.license.findFirst({
    where: {
      users: { some: { id: userId } },
    },
  });

  if (existingLicense) {
    // Update existing license
    await prisma.license.update({
      where: { id: existingLicense.id },
      data: {
        status: "ACTIVE",
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      },
    });
  } else {
    // Create new license and link to user
    const license = await prisma.license.create({
      data: {
        type: "INDIVIDUAL",
        status: "ACTIVE",
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        users: {
          connect: { id: userId },
        },
      },
    });

    // Update user's license status
    await prisma.user.update({
      where: { id: userId },
      data: {
        licenseStatus: "ACTIVE",
        licenseId: license.id,
      },
    });
  }

  // Also update user status directly
  await prisma.user.update({
    where: { id: userId },
    data: {
      licenseStatus: "ACTIVE",
    },
  });

  console.log(`License activated for user ${userId}`);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // Renewal payment succeeded - ensure license is active
  const subscriptionId = invoice.subscription as string;

  const license = await prisma.license.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    include: { users: true },
  });

  if (license) {
    await prisma.license.update({
      where: { id: license.id },
      data: { status: "ACTIVE" },
    });

    // Update all users on this license
    for (const user of license.users) {
      await prisma.user.update({
        where: { id: user.id },
        data: { licenseStatus: "ACTIVE" },
      });
    }

    console.log(`License renewed for subscription ${subscriptionId}`);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // Payment failed - could notify user or add grace period
  const subscriptionId = invoice.subscription as string;

  console.log(`Payment failed for subscription ${subscriptionId}`);

  // For now, we'll keep them active during Stripe's retry period
  // Stripe will eventually cancel if all retries fail
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  // Subscription canceled or expired
  const license = await prisma.license.findFirst({
    where: { stripeSubscriptionId: subscription.id },
    include: { users: true },
  });

  if (license) {
    await prisma.license.update({
      where: { id: license.id },
      data: { status: "CANCELLED" },
    });

    // Update all users on this license
    for (const user of license.users) {
      await prisma.user.update({
        where: { id: user.id },
        data: { licenseStatus: "EXPIRED" },
      });
    }

    console.log(`License canceled for subscription ${subscription.id}`);
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  // Handle status changes (e.g., past_due, unpaid)
  const license = await prisma.license.findFirst({
    where: { stripeSubscriptionId: subscription.id },
    include: { users: true },
  });

  if (!license) return;

  let licenseStatus: "ACTIVE" | "EXPIRED" | "SUSPENDED" = "ACTIVE";

  if (subscription.status === "active" || subscription.status === "trialing") {
    licenseStatus = "ACTIVE";
  } else if (
    subscription.status === "past_due" ||
    subscription.status === "unpaid"
  ) {
    licenseStatus = "SUSPENDED";
  } else if (
    subscription.status === "canceled" ||
    subscription.status === "incomplete_expired"
  ) {
    licenseStatus = "EXPIRED";
  }

  await prisma.license.update({
    where: { id: license.id },
    data: {
      status:
        licenseStatus === "SUSPENDED"
          ? "ACTIVE"
          : licenseStatus === "EXPIRED"
          ? "CANCELLED"
          : "ACTIVE",
    },
  });

  // Update users
  for (const user of license.users) {
    await prisma.user.update({
      where: { id: user.id },
      data: { licenseStatus },
    });
  }

  console.log(
    `Subscription ${subscription.id} updated to status: ${subscription.status}`
  );
}
