import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get user's subscription ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionId: true },
    });

    if (!user?.subscriptionId) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 400 }
      );
    }

    // Get base URL dynamically from request headers
    // Prioritize request headers over NEXTAUTH_URL to avoid wrong domain issues
    const host = req.headers.get("host") || req.headers.get("x-forwarded-host");
    const protocol = req.headers.get("x-forwarded-proto") || "https";
    const baseUrl = host
      ? `${protocol}://${host}`
      : process.env.NEXTAUTH_URL || "";

    if (!baseUrl) {
      return NextResponse.json(
        { error: "Unable to determine base URL" },
        { status: 500 }
      );
    }

    // Get customer ID from subscription
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(
      user.subscriptionId
    );
    const customerId = subscription.customer as string;

    // Create billing portal session with dynamic base URL
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/settings`,
    });

    return NextResponse.json({
      url: portalSession.url,
    });
  } catch (error: unknown) {
    console.error("Stripe portal error:", error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to create portal session";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
