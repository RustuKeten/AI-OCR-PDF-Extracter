import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { PLAN_CREDITS } from "@/lib/stripe";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature");

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Missing stripe signature or webhook secret");
    return NextResponse.json(
      { error: "Missing stripe signature" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  const stripe = getStripe();
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : "Webhook signature verification failed";
    console.error("Webhook signature verification failed:", errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  // Log all webhook events for debugging
  console.log(`[Webhook] Received event: ${event.type}`, {
    id: event.id,
    type: event.type,
    created: event.created,
  });

  try {
    switch (event.type) {
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice).catch(
          (err) => {
            console.error("[Webhook] Error in handleInvoicePaid:", err);
          }
        );
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription
        ).catch((err) => {
          console.error("[Webhook] Error in handleSubscriptionUpdated:", err);
        });
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription
        ).catch((err) => {
          console.error("[Webhook] Error in handleSubscriptionDeleted:", err);
        });
        break;

      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session
        ).catch((err) => {
          console.error("[Webhook] Error in handleCheckoutCompleted:", err);
        });
        break;

      case "customer.subscription.created":
        await handleSubscriptionCreated(
          event.data.object as Stripe.Subscription
        ).catch((err) => {
          console.error("[Webhook] Error in handleSubscriptionCreated:", err);
        });
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    // Always return success to Stripe to prevent retries for non-critical errors
    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error(`[Webhook] Error processing event ${event.type}:`, error);
    // Still return 200 to prevent Stripe from retrying indefinitely
    // Log the error for debugging but don't crash the app
    return NextResponse.json({
      received: true,
      error: "Webhook processed with errors",
    });
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  console.log("[Webhook] Processing invoice.paid", { invoiceId: invoice.id });

  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) {
    console.log("[Webhook] Invoice has no subscription");
    return;
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = subscription.customer as string;

  // Find user by subscription ID first
  let user = await prisma.user.findFirst({
    where: { subscriptionId: subscriptionId },
  });

  // If not found, try to find by customer email
  if (!user) {
    const customer = await stripe.customers.retrieve(customerId);
    if (typeof customer !== "string" && !customer.deleted && customer.email) {
      user = await prisma.user.findUnique({
        where: { email: customer.email },
      });

      // If user found, update subscription ID
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { subscriptionId: subscriptionId },
        });
        console.log(
          `[Webhook] Linked subscription ${subscriptionId} to user ${user.id} by email`
        );
      }
    }
  }

  if (!user) {
    console.log(`[Webhook] User not found for subscription ${subscriptionId}`);
    return;
  }

  // Determine plan type from price ID
  const priceId = subscription.items.data[0]?.price.id;
  const planType =
    priceId === process.env.STRIPE_PRICE_PRO
      ? "PRO"
      : priceId === process.env.STRIPE_PRICE_BASIC
      ? "BASIC"
      : "FREE";

  // Add credits based on plan
  const creditsToAdd = PLAN_CREDITS[planType as keyof typeof PLAN_CREDITS] || 0;

  if (creditsToAdd > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        credits: {
          increment: creditsToAdd,
        },
        planType: planType,
      },
    });

    console.log(
      `[Webhook] Added ${creditsToAdd} credits to user ${user.id} for ${planType} plan`
    );
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log("[Webhook] Processing subscription.updated", {
    subscriptionId: subscription.id,
  });

  // Find user by subscription ID first
  let user = await prisma.user.findFirst({
    where: { subscriptionId: subscription.id },
  });

  // If not found, try to find by customer email
  if (!user) {
    const customerId = subscription.customer as string;
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(customerId);

    if (typeof customer !== "string" && !customer.deleted && customer.email) {
      user = await prisma.user.findUnique({
        where: { email: customer.email },
      });

      // If user found, update subscription ID
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { subscriptionId: subscription.id },
        });
        console.log(
          `[Webhook] Linked subscription ${subscription.id} to user ${user.id} by email`
        );
      }
    }
  }

  if (!user) {
    console.log(`[Webhook] User not found for subscription ${subscription.id}`);
    return;
  }

  // Determine plan type from price ID
  const priceId = subscription.items.data[0]?.price.id;
  const planType =
    priceId === process.env.STRIPE_PRICE_PRO
      ? "PRO"
      : priceId === process.env.STRIPE_PRICE_BASIC
      ? "BASIC"
      : "FREE";

  // Update user plan type
  await prisma.user.update({
    where: { id: user.id },
    data: {
      planType: planType,
    },
  });

  console.log(`[Webhook] Updated user ${user.id} to ${planType} plan`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log("[Webhook] Processing subscription.deleted", {
    subscriptionId: subscription.id,
  });

  const user = await prisma.user.findFirst({
    where: { subscriptionId: subscription.id },
  });

  if (!user) {
    console.log(`[Webhook] User not found for subscription ${subscription.id}`);
    return;
  }

  // Reset to FREE plan and clear subscription ID
  await prisma.user.update({
    where: { id: user.id },
    data: {
      planType: "FREE",
      subscriptionId: null,
    },
  });

  console.log(`[Webhook] Reset user ${user.id} to FREE plan`);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log("[Webhook] Processing checkout.session.completed", {
    sessionId: session.id,
  });

  const userId = session.metadata?.userId;
  const planType = session.metadata?.planType;

  if (!userId) {
    console.log("[Webhook] No userId in checkout session metadata");
    return;
  }

  // Get subscription ID from checkout session
  const subscriptionId = session.subscription as string;
  if (!subscriptionId) {
    console.log("[Webhook] No subscription ID in checkout session");
    return;
  }

  // Add credits based on plan
  const creditsToAdd =
    PLAN_CREDITS[planType as keyof typeof PLAN_CREDITS] || PLAN_CREDITS.BASIC;

  // Update user with subscription ID and add credits
  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionId: subscriptionId,
      planType: planType || "BASIC",
      credits: {
        increment: creditsToAdd,
      },
    },
  });

  console.log(
    `[Webhook] Checkout completed for user ${userId}: Added ${creditsToAdd} credits, plan ${planType}`
  );
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  console.log("[Webhook] Processing subscription.created", {
    subscriptionId: subscription.id,
  });

  const customerId = subscription.customer as string;

  // Find user by customer ID (via subscription metadata or email lookup)
  // For now, we'll use the checkout.session.completed handler which already saves subscriptionId
  // This is a backup handler in case checkout.session.completed doesn't fire

  // Get customer to find user email
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(customerId);
  if (typeof customer === "string" || customer.deleted) {
    console.log("[Webhook] Customer not found or deleted");
    return;
  }

  const userEmail = customer.email;
  if (!userEmail) {
    console.log("[Webhook] Customer has no email");
    return;
  }

  // Find user by email and update subscription ID if not set
  const user = await prisma.user.findUnique({
    where: { email: userEmail },
  });

  if (user && !user.subscriptionId) {
    const priceId = subscription.items.data[0]?.price.id;
    const planType =
      priceId === process.env.STRIPE_PRICE_PRO
        ? "PRO"
        : priceId === process.env.STRIPE_PRICE_BASIC
        ? "BASIC"
        : "FREE";

    const creditsToAdd =
      PLAN_CREDITS[planType as keyof typeof PLAN_CREDITS] || 0;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionId: subscription.id,
        planType: planType,
        credits: creditsToAdd > 0 ? { increment: creditsToAdd } : undefined,
      },
    });

    console.log(
      `[Webhook] Subscription created for user ${user.id}: Added ${creditsToAdd} credits, plan ${planType}`
    );
  }
}
