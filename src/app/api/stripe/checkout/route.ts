import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PLAN_CREDITS } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const userEmail = session.user.email;

    const body = await req.json();
    const { planType } = body; // "BASIC" or "PRO"

    if (!planType || !["BASIC", "PRO"].includes(planType)) {
      return NextResponse.json(
        { error: "Invalid plan type. Must be BASIC or PRO" },
        { status: 400 }
      );
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { planType: true, subscriptionId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get price ID from environment variables
    const priceId =
      planType === "BASIC"
        ? process.env.STRIPE_PRICE_BASIC
        : process.env.STRIPE_PRICE_PRO;

    if (!priceId) {
      return NextResponse.json(
        { error: `Stripe price ID for ${planType} not configured` },
        { status: 500 }
      );
    }

    // Get base URL dynamically from request headers
    // This ensures we use the correct domain even if NEXTAUTH_URL is wrong
    const host = req.headers.get("host") || req.headers.get("x-forwarded-host");
    const protocol = req.headers.get("x-forwarded-proto") || "https";
    // Prioritize request headers over NEXTAUTH_URL to avoid wrong domain issues
    const baseUrl = host ? `${protocol}://${host}` : process.env.NEXTAUTH_URL || "";
    
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Unable to determine base URL" },
        { status: 500 }
      );
    }

    // Create or get Stripe customer
    let customerId: string;
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    const stripe = getStripe();
    
    // If user already has a subscription, cancel it first and get customer ID
    if (existingUser?.subscriptionId) {
      try {
        const existingSubscription = await stripe.subscriptions.retrieve(
          existingUser.subscriptionId
        );
        customerId = existingSubscription.customer as string;
        
        // Cancel existing subscription (for upgrade scenario)
        await stripe.subscriptions.update(existingUser.subscriptionId, {
          cancel_at_period_end: false,
        });
        await stripe.subscriptions.cancel(existingUser.subscriptionId);
      } catch (error) {
        console.error("Error canceling existing subscription:", error);
        // If subscription doesn't exist, create new customer
        const customer = await stripe.customers.create({
          email: userEmail,
          metadata: {
            userId: userId,
          },
        });
        customerId = customer.id;
      }
    } else {
      // Create new customer
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          userId: userId,
        },
      });
      customerId = customer.id;
    }

    // Create checkout session with dynamic base URL
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${baseUrl}/settings?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/settings?canceled=true`,
      metadata: {
        userId: userId,
        planType: planType,
      },
    });

    return NextResponse.json({
      sessionId: checkoutSession.id,
      url: checkoutSession.url,
    });
  } catch (error: unknown) {
    console.error("Stripe checkout error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create checkout session";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

